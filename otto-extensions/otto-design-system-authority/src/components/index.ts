import { deepFreeze } from "../core/freeze.js";
import { buttonPrimitive } from "./button.js";
import { cardPrimitive } from "./card.js";
import { iconPrimitive } from "./icon.js";
import { inputPrimitive } from "./input.js";
import { listPrimitive } from "./list.js";
import { modalPrimitive } from "./modal.js";
import { panelPrimitive } from "./panel.js";
import { tabPrimitive } from "./tab.js";

export type { ComponentPrimitive, PrimitiveName, ResolvedPrimitiveStyle } from "./types.js";
export {
  buttonPrimitive,
  cardPrimitive,
  iconPrimitive,
  inputPrimitive,
  listPrimitive,
  modalPrimitive,
  panelPrimitive,
  tabPrimitive
};

export const componentPrimitives = deepFreeze({
  Button: buttonPrimitive,
  Input: inputPrimitive,
  Card: cardPrimitive,
  Panel: panelPrimitive,
  Modal: modalPrimitive,
  List: listPrimitive,
  Tab: tabPrimitive,
  Icon: iconPrimitive
} as const);
