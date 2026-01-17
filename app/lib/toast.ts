"use client";

import { message } from "antd";

export const toast = {
  success: (content: string) => {
    message.success({ content, duration: 2 });
  },
  error: (content: string) => {
    message.error({ content, duration: 3 });
  },
  info: (content: string) => {
    message.info({ content, duration: 2 });
  },
};
