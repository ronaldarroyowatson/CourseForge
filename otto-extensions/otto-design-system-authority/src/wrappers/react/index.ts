import {
  buttonPrimitive,
  cardPrimitive,
  iconPrimitive,
  inputPrimitive,
  listPrimitive,
  modalPrimitive,
  panelPrimitive,
  tabPrimitive
} from "../../components/index.js";
import { createReactPrimitiveProps, type ReactWrapperOptions } from "./create-react-props.js";

export { createReactPrimitiveProps, type ReactPrimitiveProps, type ReactWrapperOptions } from "./create-react-props.js";

export const reactWrappers = {
  Button: (options?: ReactWrapperOptions) => createReactPrimitiveProps(buttonPrimitive, options),
  Input: (options?: ReactWrapperOptions) => createReactPrimitiveProps(inputPrimitive, options),
  Card: (options?: ReactWrapperOptions) => createReactPrimitiveProps(cardPrimitive, options),
  Panel: (options?: ReactWrapperOptions) => createReactPrimitiveProps(panelPrimitive, options),
  Modal: (options?: ReactWrapperOptions) => createReactPrimitiveProps(modalPrimitive, options),
  List: (options?: ReactWrapperOptions) => createReactPrimitiveProps(listPrimitive, options),
  Tab: (options?: ReactWrapperOptions) => createReactPrimitiveProps(tabPrimitive, options),
  Icon: (options?: ReactWrapperOptions) => createReactPrimitiveProps(iconPrimitive, options)
} as const;
