//#region src/utils/fast-json-patch/src/core.d.ts
export type Operation = AddOperation<any> | RemoveOperation | ReplaceOperation<any> | MoveOperation | CopyOperation | TestOperation<any> | GetOperation<any>;
export interface Validator<T> {
  (operation: Operation, index: number, document: T, existingPathFragment: string): void;
}
export interface OperationResult<T> {
  removed?: any;
  test?: boolean;
  newDocument: T;
}
export interface BaseOperation {
  path: string;
}
export interface AddOperation<T> extends BaseOperation {
  op: "add";
  value: T;
}
export interface RemoveOperation extends BaseOperation {
  op: "remove";
}
export interface ReplaceOperation<T> extends BaseOperation {
  op: "replace";
  value: T;
}
export interface MoveOperation extends BaseOperation {
  op: "move";
  from: string;
}
export interface CopyOperation extends BaseOperation {
  op: "copy";
  from: string;
}
export interface TestOperation<T> extends BaseOperation {
  op: "test";
  value: T;
}
export interface GetOperation<T> extends BaseOperation {
  op: "_get";
  value: T;
}
export interface PatchResult<T> extends Array<OperationResult<T>> {
  newDocument: T;
}
/**
 * Apply a full JSON Patch array on a JSON document.
 * Returns the {newDocument, result} of the patch.
 * It modifies the `document` object and `patch` - it gets the values by reference.
 * If you would like to avoid touching your values, clone them:
 * `jsonpatch.applyPatch(document, jsonpatch._deepClone(patch))`.
 *
 * @param document The document to patch
 * @param patch The patch to apply
 * @param validateOperation `false` is without validation, `true` to use default jsonpatch's validation, or you can pass a `validateOperation` callback to be used for validation.
 * @param mutateDocument Whether to mutate the original document or clone it before applying
 * @param banPrototypeModifications Whether to ban modifications to `__proto__`, defaults to `true`.
 * @return An array of `{newDocument, result}` after the patch
 */
export declare function applyPatch<T>(document: T, patch: ReadonlyArray<Operation>, validateOperation?: boolean | Validator<T>, mutateDocument?: boolean, banPrototypeModifications?: boolean): PatchResult<T>;
//#endregion
//# sourceMappingURL=core.d.ts.map