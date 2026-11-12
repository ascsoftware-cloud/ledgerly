"use client";

import { useEffect } from "react";
import { markViewed } from "../public-actions";

/** Tells the business their client opened the link. Runs once per page view, in the browser only. */
export function MarkViewed({ token }: { token: string }) {
  useEffect(() => {
    void markViewed(token);
  }, [token]);
  return null;
}
