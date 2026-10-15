import { ErrorMessages } from "../errorMessages.js";
import { JsonSchema7Type } from "../parseTypes.js";
import "../Refs.js";
import "zod/v3";
//#region src/utils/zod-to-json-schema/parsers/array.d.ts
export type JsonSchema7ArrayType = {
  type: "array";
  items?: JsonSchema7Type;
  minItems?: number;
  maxItems?: number;
  errorMessages?: ErrorMessages<JsonSchema7ArrayType, "items">;
};
//#endregion
//# sourceMappingURL=array.d.ts.map