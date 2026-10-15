import { JsonSchema7TypeUnion } from "./parseTypes.js";
import "./Refs.js";
//#region src/utils/zod-to-json-schema/errorMessages.d.ts
export type ErrorMessages<T extends JsonSchema7TypeUnion | {
  format: string;
} | {
  pattern: string;
}, OmitProperties extends string = ""> = Partial<Omit<{ [key in keyof T]: string; }, OmitProperties | "type" | "errorMessages">>;
//#endregion
//# sourceMappingURL=errorMessages.d.ts.map