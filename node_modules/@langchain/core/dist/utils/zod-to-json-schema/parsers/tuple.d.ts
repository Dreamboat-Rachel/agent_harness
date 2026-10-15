import { JsonSchema7Type } from "../parseTypes.js";
import "../Refs.js";
import "zod/v3";
//#region src/utils/zod-to-json-schema/parsers/tuple.d.ts
export type JsonSchema7TupleType = {
  type: "array";
  minItems: number;
  items: JsonSchema7Type[];
} & ({
  maxItems: number;
} | {
  additionalItems?: JsonSchema7Type;
});
//#endregion
//# sourceMappingURL=tuple.d.ts.map