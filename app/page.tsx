"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LogoutOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Input,
  Layout,
  List,
  Modal,
  Select,
  Space,
  Spin,
  Typography,
} from "antd";
import { useRouter } from "next/navigation";
import { TaskRow } from "./types/task";
import { ProjectRow } from "./types/project";
import { supabaseBrowser } from "./lib/supabaseBrowser";
import {
  friendlySupabaseError,
  isMissingTableError,
} from "./lib/supabaseErrors";
import { toast } from "./lib/toast";
import TaskComposer from "./components/TaskComposer";
import ActiveStopwatch from "./components/ActiveStopwatch";
import HistoryTable from "./components/HistoryTable";
import {
  ACTIVE_PROJECT_ID_KEY,
  ACTIVE_TASK_KEY,
  ACTIVE_TASK_RUNNING_START_KEY,
} from "./lib/storageKeys";

type StoredActiveTask = {
  projectId: string;
  taskId: string;
};

const readStoredActiveTask = (): StoredActiveTask | null => {
  const raw = localStorage.getItem(ACTIVE_TASK_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredActiveTask;
    if (!parsed?.projectId || !parsed?.taskId) return null;
    return parsed;
  } catch {
    return null;
  }
};

export default function Page() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileUsername, setProfileUsername] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const projectsUnavailableRef = useRef(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [manageProjectsOpen, setManageProjectsOpen] = useState(false);
  const [manageProjectsLoading, setManageProjectsLoading] = useState(false);
  const [projectTaskCounts, setProjectTaskCounts] = useState<
    Record<string, number>
  >({});
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [savingProjectId, setSavingProjectId] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<TaskRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const projectsCacheRef = useRef<{
    userId: string;
    projects: ProjectRow[];
  } | null>(null);
  const projectsInFlightRef = useRef<string | null>(null);
  const activeTaskInFlightRef = useRef<string | null>(null);
  const profileCacheRef = useRef<{
    userId: string;
    username: string | null;
  } | null>(null);
  const profileInFlightRef = useRef<string | null>(null);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );
  const username =
    profileUsername ??
    (user?.user_metadata?.username as string | undefined) ??
    user?.email?.split("@")[0] ??
    "User";

  const applyProjects = useCallback((nextProjects: ProjectRow[]) => {
    setProjects(nextProjects);

    const storedActive = readStoredActiveTask();
    const storedProjectId = localStorage.getItem(ACTIVE_PROJECT_ID_KEY);
    const storedProjectMatch = nextProjects.find(
      (project) => project.id === storedProjectId,
    );
    const activeProjectMatch = nextProjects.find(
      (project) => project.id === storedActive?.projectId,
    );

    const nextActiveProjectId =
      activeProjectMatch?.id ??
      storedProjectMatch?.id ??
      nextProjects[0]?.id ??
      null;

    setActiveProjectId(nextActiveProjectId);
    if (nextActiveProjectId) {
      localStorage.setItem(ACTIVE_PROJECT_ID_KEY, nextActiveProjectId);
    } else {
      localStorage.removeItem(ACTIVE_PROJECT_ID_KEY);
    }
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      const { data } = await supabaseBrowser.auth.getUser();
      if (!data?.user) {
        setUser(null);
        setProfileUsername(null);
        setAuthLoading(false);
        router.replace("/auth");
        return;
      }
      setUser(data.user);
      setProfileUsername(
        (data.user.user_metadata?.username as string | undefined) ?? null,
      );
      setAuthLoading(false);
    };

    const { data: authListener } = supabaseBrowser.auth.onAuthStateChange(
      (_event, session) => {
        if (!session?.user) {
          setUser(null);
          setProfileUsername(null);
          router.replace("/auth");
          return;
        }
        setUser(session.user);
        setProfileUsername(
          (session.user.user_metadata?.username as string | undefined) ?? null,
        );
      },
    );

    initAuth();

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    const loadProjects = async () => {
      if (!user || projectsUnavailableRef.current) return;
      const cache = projectsCacheRef.current;
      if (cache?.userId === user.id) {
        applyProjects(cache.projects);
        return;
      }
      if (projectsInFlightRef.current === user.id) {
        return;
      }
      projectsInFlightRef.current = user.id;
      setProjectsLoading(true);
      const { data, error } = await supabaseBrowser
        .from("projects")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      setProjectsLoading(false);
      projectsInFlightRef.current = null;

      if (error) {
        toast.error(friendlySupabaseError(error.message));
        if (isMissingTableError(error.message)) {
          projectsUnavailableRef.current = true;
          applyProjects([]);
        }
        return;
      }

      const nextProjects = (data as ProjectRow[]) ?? [];
      projectsCacheRef.current = { userId: user.id, projects: nextProjects };
      applyProjects(nextProjects);
    };

    loadProjects();
  }, [user, applyProjects]);

  useEffect(() => {
    projectsUnavailableRef.current = false;
    projectsCacheRef.current = null;
    projectsInFlightRef.current = null;
    profileCacheRef.current = null;
    profileInFlightRef.current = null;
  }, [user?.id]);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;
      const cache = profileCacheRef.current;
      if (cache?.userId === user.id) {
        setProfileUsername(cache.username);
        return;
      }
      if (profileInFlightRef.current === user.id) {
        return;
      }
      profileInFlightRef.current = user.id;
      const { data, error } = await supabaseBrowser
        .from("user_profiles")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();

      profileInFlightRef.current = null;

      if (error) {
        toast.error(friendlySupabaseError(error.message));
        if (isMissingTableError(error.message)) {
          setProfileUsername(null);
        }
        return;
      }

      const nextUsername = data?.username ?? null;
      profileCacheRef.current = { userId: user.id, username: nextUsername };
      setProfileUsername(nextUsername);
    };

    loadProfile();
  }, [user]);

  useEffect(() => {
    const loadActiveTask = async () => {
      if (!user || !activeProjectId) {
        setActiveTask(null);
        return;
      }

      const stored = readStoredActiveTask();
      if (!stored || stored.projectId !== activeProjectId) {
        setActiveTask(null);
        return;
      }

      const requestKey = `${user.id}:${activeProjectId}:${stored.taskId}`;
      if (activeTaskInFlightRef.current === requestKey) {
        return;
      }
      activeTaskInFlightRef.current = requestKey;

      const { data, error } = await supabaseBrowser
        .from("tasks")
        .select("*")
        .eq("id", stored.taskId)
        .eq("project_id", activeProjectId)
        .eq("user_id", user.id)
        .maybeSingle();

      activeTaskInFlightRef.current = null;

      if (error) {
        toast.error(friendlySupabaseError(error.message));
        if (isMissingTableError(error.message)) {
          localStorage.removeItem(ACTIVE_TASK_KEY);
          localStorage.removeItem(ACTIVE_TASK_RUNNING_START_KEY);
          setActiveTask(null);
        }
        return;
      }

      if (data && (data.status === "running" || data.status === "paused")) {
        setActiveTask(data as TaskRow);
      } else {
        localStorage.removeItem(ACTIVE_TASK_KEY);
        localStorage.removeItem(ACTIVE_TASK_RUNNING_START_KEY);
        setActiveTask(null);
      }
    };

    loadActiveTask();
  }, [activeProjectId, user]);

  const onTaskCreated = (task: TaskRow) => {
    localStorage.setItem(
      ACTIVE_TASK_KEY,
      JSON.stringify({ projectId: task.project_id, taskId: task.id }),
    );
    setActiveTask(task);
    setRefreshKey((x) => x + 1);
  };

  const onTaskEndedOrCanceled = () => {
    localStorage.removeItem(ACTIVE_TASK_KEY);
    localStorage.removeItem(ACTIVE_TASK_RUNNING_START_KEY);
    setActiveTask(null);
    setRefreshKey((x) => x + 1);
  };

  const onTaskUpdated = (task: TaskRow) => {
    setActiveTask(task);
    setRefreshKey((x) => x + 1);
  };

  const createProject = async () => {
    const name = newProjectName.trim();
    if (!name || !user) {
      toast.error("Project name is required.");
      return;
    }

    setCreatingProject(true);
    const { data, error } = await supabaseBrowser
      .from("projects")
      .insert({
        name,
        user_id: user.id,
      })
      .select("*")
      .single();

    setCreatingProject(false);

    if (error) {
      toast.error(friendlySupabaseError(error.message));
      if (isMissingTableError(error.message)) {
        projectsUnavailableRef.current = true;
      }
      return;
    }

    const project = data as ProjectRow;
    setProjects((prev) => {
      const next = [...prev, project];
      projectsCacheRef.current = user
        ? { userId: user.id, projects: next }
        : null;
      return next;
    });
    setActiveProjectId(project.id);
    localStorage.setItem(ACTIVE_PROJECT_ID_KEY, project.id);
    setCreateProjectOpen(false);
    setNewProjectName("");
    toast.success("Project created.");
  };

  const loadProjectTaskCounts = async () => {
    if (!user) return;
    setManageProjectsLoading(true);
    const results = await Promise.all(
      projects.map(async (project) => {
        const { count, error } = await supabaseBrowser
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("project_id", project.id)
          .eq("user_id", user.id);
        return {
          id: project.id,
          count: count ?? 0,
          error,
        };
      }),
    );

    let firstError: string | null = null;
    const nextCounts: Record<string, number> = {};
    results.forEach((result) => {
      if (result.error && !firstError) {
        firstError = result.error.message;
      }
      nextCounts[result.id] = result.error ? 0 : result.count ?? 0;
    });

    if (firstError) {
      toast.error(friendlySupabaseError(firstError));
    }

    setProjectTaskCounts(nextCounts);
    setManageProjectsLoading(false);
  };

  const openManageProjects = () => {
    setEditingProjectId(null);
    setEditingProjectName("");
    setManageProjectsOpen(true);
    loadProjectTaskCounts();
  };

  const closeManageProjects = () => {
    setManageProjectsOpen(false);
    setEditingProjectId(null);
    setEditingProjectName("");
  };

  const startEditProject = (project: ProjectRow) => {
    setEditingProjectId(project.id);
    setEditingProjectName(project.name);
  };

  const cancelEditProject = () => {
    setEditingProjectId(null);
    setEditingProjectName("");
  };

  const saveProject = async (projectId: string) => {
    const name = editingProjectName.trim();
    if (!name || !user) {
      toast.error("Project name is required.");
      return;
    }

    setSavingProjectId(projectId);
    const { data, error } = await supabaseBrowser
      .from("projects")
      .update({ name })
      .eq("id", projectId)
      .eq("user_id", user.id)
      .select("*")
      .single();
    setSavingProjectId(null);

    if (error) {
      toast.error(friendlySupabaseError(error.message));
      return;
    }

    const updated = data as ProjectRow;
    const nextProjects = projects.map((project) =>
      project.id === projectId ? updated : project,
    );
    setProjects(nextProjects);
    projectsCacheRef.current = { userId: user.id, projects: nextProjects };
    cancelEditProject();
    toast.success("Project updated.");
  };

  const deleteProject = async (project: ProjectRow) => {
    if (!user) return;
    const taskCount = projectTaskCounts[project.id] ?? 0;
    if (taskCount > 0) return;

    setDeletingProjectId(project.id);
    const { error } = await supabaseBrowser
      .from("projects")
      .delete()
      .eq("id", project.id)
      .eq("user_id", user.id);
    setDeletingProjectId(null);

    if (error) {
      toast.error(friendlySupabaseError(error.message));
      return;
    }

    const nextProjects = projects.filter(
      (existing) => existing.id !== project.id,
    );
    projectsCacheRef.current = { userId: user.id, projects: nextProjects };
    applyProjects(nextProjects);
    setProjectTaskCounts((prev) => {
      const next = { ...prev };
      delete next[project.id];
      return next;
    });
    if (editingProjectId === project.id) {
      cancelEditProject();
    }
    toast.success("Project deleted.");
  };

  const handleProjectChange = (nextProjectId: string) => {
    if (activeTask && activeTask.project_id !== nextProjectId) {
      toast.info("Finish or cancel the active task before switching projects.");
      return;
    }
    setActiveProjectId(nextProjectId);
    localStorage.setItem(ACTIVE_PROJECT_ID_KEY, nextProjectId);
  };

  const signOut = async () => {
    await supabaseBrowser.auth.signOut();
    localStorage.removeItem(ACTIVE_TASK_KEY);
    localStorage.removeItem(ACTIVE_PROJECT_ID_KEY);
    localStorage.removeItem(ACTIVE_TASK_RUNNING_START_KEY);
    setActiveTask(null);
    setActiveProjectId(null);
    setProjects([]);
    setProfileUsername(null);
    projectsUnavailableRef.current = false;
    projectsCacheRef.current = null;
    projectsInFlightRef.current = null;
    profileCacheRef.current = null;
    profileInFlightRef.current = null;
    activeTaskInFlightRef.current = null;
    router.replace("/auth");
  };

  if (authLoading) {
    return (
      <Layout style={{ height: "100vh", background: "#f5f5f5" }}>
        <Layout.Content
          style={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Spin size="large" />
        </Layout.Content>
      </Layout>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <Layout
      style={{ height: "100vh", overflow: "hidden", background: "#f5f5f5" }}
    >
      <Layout.Header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          background: "#ffffff",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <Typography.Text style={{ fontSize: 18, fontWeight: 600 }}>
          Personal Time & Task Tracker
        </Typography.Text>
        <Space size="middle">
          <Typography.Text type="secondary">
            Signed in as {username}
          </Typography.Text>
          <Button
            type="text"
            icon={<LogoutOutlined />}
            onClick={signOut}
            aria-label="Sign out"
            title="Sign out"
          />
        </Space>
      </Layout.Header>
      <Layout.Content className="page-content">
        <div className="dashboard">
          <div className="dashboard-top">
            <div className="overview-stack">
              <div className="overview-panel">
                <div className="overview-row">
                  <Typography.Title level={5} className="overview-title">
                    Projects
                  </Typography.Title>
                <Select
                  className="overview-select"
                  placeholder="Select project"
                  loading={projectsLoading}
                  value={activeProjectId ?? undefined}
                  disabled={activeTask?.status === "running"}
                  options={projects.map((project) => ({
                    label: project.name,
                    value: project.id,
                  }))}
                  onChange={handleProjectChange}
                />
              <Button
                onClick={() => setCreateProjectOpen(true)}
                disabled={activeTask?.status === "running"}
              >
                New Project
              </Button>
              <Button
                onClick={openManageProjects}
                disabled={activeTask?.status === "running"}
              >
                Manage Projects
              </Button>
            </div>
            </div>

              <Card className="task-card">
                <TaskComposer
                  onCreated={onTaskCreated}
                  disabled={!!activeTask}
                  projectId={activeProjectId}
                  userId={user.id}
                />
              </Card>
            </div>

            <Card className="stopwatch-card">
              {activeTask ? (
                <ActiveStopwatch
                  key={activeTask.id}
                  task={activeTask}
                  onUpdated={onTaskUpdated}
                  onFinishedOrCanceled={onTaskEndedOrCanceled}
                />
              ) : (
                <Typography.Text type="secondary">
                  {activeProject
                    ? "No active task. Create a task to start the stopwatch."
                    : "Create a project to begin tracking tasks."}
                </Typography.Text>
              )}
            </Card>
          </div>

          <Card
            className="history-card"
            styles={{
              body: {
                height: "100%",
                display: "flex",
                flexDirection: "column",
              },
            }}
          >
            <HistoryTable
              key={`${user.id}:${activeProjectId ?? "none"}`}
              refreshKey={refreshKey}
              projectId={activeProjectId}
              projectName={activeProject?.name ?? null}
              userId={user.id}
            />
          </Card>
        </div>
      </Layout.Content>

      <Modal
        title="Create Project"
        open={createProjectOpen}
        onCancel={() => setCreateProjectOpen(false)}
        onOk={createProject}
        okText="Create"
        okButtonProps={{
          disabled: !newProjectName.trim(),
          loading: creatingProject,
        }}
      >
        <Input
          placeholder="Project name"
          value={newProjectName}
          onChange={(event) => setNewProjectName(event.target.value)}
        />
      </Modal>

      <Modal
        title="Manage Projects"
        open={manageProjectsOpen}
        onCancel={closeManageProjects}
        footer={null}
      >
        <List
          dataSource={projects}
          locale={{ emptyText: "No projects yet." }}
          loading={manageProjectsLoading}
          renderItem={(project) => {
            const isEditing = editingProjectId === project.id;
            const taskCount = projectTaskCounts[project.id];
            const taskCountLabel =
              typeof taskCount === "number" ? taskCount : "...";
            const canDelete =
              typeof taskCount === "number" &&
              taskCount === 0 &&
              !manageProjectsLoading;
            return (
              <List.Item>
                <div className="project-modal__row">
                  <div className="project-modal__info">
                    {isEditing ? (
                      <Input
                        value={editingProjectName}
                        onChange={(event) =>
                          setEditingProjectName(event.target.value)
                        }
                        onPressEnter={() => saveProject(project.id)}
                      />
                    ) : (
                      <Typography.Text strong>{project.name}</Typography.Text>
                    )}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Tasks: {taskCountLabel}
                    </Typography.Text>
                  </div>

                  <div className="project-modal__actions">
                    {isEditing ? (
                      <>
                        <Button
                          type="primary"
                          size="small"
                          onClick={() => saveProject(project.id)}
                          loading={savingProjectId === project.id}
                        >
                          Save
                        </Button>
                        <Button
                          size="small"
                          onClick={cancelEditProject}
                          disabled={savingProjectId === project.id}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="small"
                          onClick={() => startEditProject(project)}
                          disabled={manageProjectsLoading}
                        >
                          Edit
                        </Button>
                        <Button
                          danger
                          size="small"
                          onClick={() => deleteProject(project)}
                          disabled={!canDelete}
                          loading={deletingProjectId === project.id}
                          title={
                            canDelete
                              ? "Delete project"
                              : "Delete disabled while tasks exist."
                          }
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </List.Item>
            );
          }}
        />
      </Modal>
    </Layout>
  );
}
