"use client";

import { useEffect, useState } from "react";

const TUTORIAL_KEY = "skinly:tutorial:v1";

export function useTutorial() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(TUTORIAL_KEY)) setShow(true);
    } catch {
      // private mode / disabled storage — skip tutorial
    }
  }, []);

  function finish() {
    try {
      localStorage.setItem(TUTORIAL_KEY, "true");
    } catch {
      // ignore
    }
    setShow(false);
  }

  return { show, finish };
}
