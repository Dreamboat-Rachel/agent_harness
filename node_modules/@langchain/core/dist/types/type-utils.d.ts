//#region src/types/type-utils.d.ts
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type DeepPartial<T> = { [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]; };
//#endregion
//# sourceMappingURL=type-utils.d.ts.map