"use client";

import { useEffect, useState } from "react";
import { Button, Card, Form, Input, Tabs, Typography } from "antd";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "../lib/supabaseBrowser";
import { toast } from "../lib/toast";

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

const toAuthEmail = (username: string) =>
  `${username.toLowerCase()}@timetracker.com`;

export default function AuthPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabaseBrowser.auth.getUser();
      if (data?.user) {
        router.replace("/");
      }
    };
    checkSession();
  }, [router]);

  const signUp = async (values: { username: string; password: string }) => {
    const username = values.username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      toast.error("Username must be 3-32 characters: a-z, 0-9, ., _, -.");
      return;
    }

    setLoading(true);
    const { data, error } = await supabaseBrowser.auth.signUp({
      email: toAuthEmail(username),
      password: values.password,
      options: {
        data: { username },
      },
    });

    if (error) {
      setLoading(false);
      const message = error.message.toLowerCase().includes("already registered")
        ? "Username already exists."
        : error.message;
      toast.error(message);
      return;
    }

    let userId = data?.user?.id ?? null;

    if (!data?.session) {
      const { data: signInData, error: signInError } =
        await supabaseBrowser.auth.signInWithPassword({
          email: toAuthEmail(username),
          password: values.password,
        });

      if (signInError) {
        setLoading(false);
        toast.error("Signup requires email confirmation to be disabled.");
        return;
      }

      userId = signInData.user?.id ?? null;
    }

    if (!userId) {
      setLoading(false);
      toast.error("Unable to create a session.");
      return;
    }

    const { error: profileError } = await supabaseBrowser
      .from("user_profiles")
      .insert({
        id: userId,
        username,
      });

    setLoading(false);

    if (profileError) {
      await supabaseBrowser.auth.signOut();
      const message = profileError.message.toLowerCase().includes("duplicate")
        ? "Username already exists."
        : profileError.message;
      toast.error(message);
      return;
    }

    toast.success("Account created. You are now logged in.");
    router.replace("/");
  };

  const signIn = async (values: { username: string; password: string }) => {
    const username = values.username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      toast.error("Enter a valid username.");
      return;
    }

    setLoading(true);
    const { error } = await supabaseBrowser.auth.signInWithPassword({
      email: toAuthEmail(username),
      password: values.password,
    });
    setLoading(false);

    if (error) {
      toast.error("Invalid username or password.");
      return;
    }

    toast.success("Welcome back.");
    router.replace("/");
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f5f5",
        padding: 24,
      }}
    >
      <Card style={{ width: 420 }}>
        <Typography.Title level={3} style={{ marginBottom: 8 }}>
          Time Tracker
        </Typography.Title>
        <Typography.Text type="secondary">
          Create an account or sign in to continue.
        </Typography.Text>

        <Tabs
          style={{ marginTop: 16 }}
          items={[
            {
              key: "login",
              label: "Log In",
              children: (
                <Form layout="vertical" onFinish={signIn} requiredMark={false}>
                  <Form.Item
                    label="Username"
                    name="username"
                    rules={[
                      { required: true, message: "Username is required." },
                    ]}
                  >
                    <Input placeholder="e.g. username" autoComplete="username" />
                  </Form.Item>
                  <Form.Item
                    label="Password"
                    name="password"
                    rules={[
                      { required: true, message: "Password is required." },
                    ]}
                  >
                    <Input.Password autoComplete="current-password" />
                  </Form.Item>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    style={{ width: "100%" }}
                  >
                    Log In
                  </Button>
                </Form>
              ),
            },
            {
              key: "signup",
              label: "Sign Up",
              children: (
                <Form layout="vertical" onFinish={signUp} requiredMark={false}>
                  <Form.Item
                    label="Username"
                    name="username"
                    rules={[
                      { required: true, message: "Username is required." },
                    ]}
                  >
                    <Input placeholder="e.g. username" autoComplete="username" />
                  </Form.Item>
                  <Form.Item
                    label="Password"
                    name="password"
                    rules={[
                      { required: true, message: "Password is required." },
                      {
                        min: 6,
                        message: "Password must be at least 6 characters.",
                      },
                    ]}
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    style={{ width: "100%" }}
                  >
                    Sign Up
                  </Button>
                </Form>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
