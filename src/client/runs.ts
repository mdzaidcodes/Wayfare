"use client";
import { useSyncExternalStore } from "react";
import type { ApiErrorBody } from "@/lib/sse-client";

// Live progress for in-flight requests, per trip and per job (not persisted).

export interface Step {
  id?: number;
  message: string;
  agent?: string;
  at: string;
  warning?: boolean;
}

export interface RunState {
  job?: string;
  steps: Step[];
  error?: ApiErrorBody & { job: string };
  startedAt?: number;
  controller?: AbortController;
}

const state = new Map<string, RunState>();
const listeners = new Set<() => void>();
const EMPTY: RunState = { steps: [] };
const emit = () => listeners.forEach((l) => l());

export function getRun(tripId: string): RunState {
  return state.get(tripId) ?? EMPTY;
}

export function startRun(tripId: string, job: string): AbortController {
  getRun(tripId).controller?.abort();
  const controller = new AbortController();
  state.set(tripId, { job, steps: [], startedAt: Date.now(), controller });
  emit();
  return controller;
}

let seq = 0;
export function addStep(tripId: string, step: Step) {
  const s = getRun(tripId);
  // Parallel work can report the same step twice; show it once.
  if (s.steps.some((x) => x.message === step.message)) return;
  state.set(tripId, { ...s, steps: [...s.steps, { ...step, id: ++seq }].slice(-40) });
  emit();
}

export function finishRun(tripId: string, error?: ApiErrorBody) {
  const s = getRun(tripId);
  state.set(tripId, { steps: s.steps, error: error ? { ...error, job: s.job ?? "" } : undefined });
  emit();
}

export function clearError(tripId: string) {
  const s = getRun(tripId);
  state.set(tripId, { ...s, error: undefined });
  emit();
}

export function useRun(tripId: string): RunState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => getRun(tripId),
    () => EMPTY,
  );
}
