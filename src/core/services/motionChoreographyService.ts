import type { DirectionalFlow } from "./designSystemService";

export type MotionRole = "enter" | "move" | "exit";

export interface ChoreographyConfig {
  easing: "ease-in" | "ease-in-out" | "ease-out";
  transition: string;
  hoverTransform: string;
}

/**
 * Returns the CSS easing for a given motion role per the choreography spec:
 * - Entering elements:               ease-in
 * - Moving/repositioning elements:   ease-in-out
 * - Exiting elements:                ease-out
 */
export function getMotionEasing(role: MotionRole): "ease-in" | "ease-in-out" | "ease-out" {
  if (role === "enter") return "ease-in";
  if (role === "exit") return "ease-out";
  return "ease-in-out";
}

/**
 * Returns a full choreography config for one motion element.
 *
 * - Timing is always driven by the user's motion token (timingMs).
 * - Easing is determined by role (not by the user's global easing setting).
 * - Transition direction is determined by directional-flow.
 */
export function getChoreographyConfig(
  role: MotionRole,
  timingMs: number,
  flow: DirectionalFlow,
): ChoreographyConfig {
  const easing = getMotionEasing(role);
  const transition = `all ${timingMs}ms ${easing}`;

  let hoverTransform: string;
  if (role === "enter") {
    hoverTransform =
      flow === "right-to-left" ? "translateX(-16px) scale(1.05)" : "translateX(16px) scale(1.05)";
  } else if (role === "exit") {
    hoverTransform =
      flow === "right-to-left" ? "translateX(16px) scale(0.95)" : "translateX(-16px) scale(0.95)";
  } else {
    hoverTransform = "translateY(-8px)";
  }

  return { easing, transition, hoverTransform };
}
