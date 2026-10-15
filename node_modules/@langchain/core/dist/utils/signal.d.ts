//#region src/utils/signal.d.ts
/**
 * Race a promise with an abort signal. If the signal is aborted, the promise will
 * be rejected with the error from the signal. If the promise is rejected, the signal will be aborted.
 *
 * @param promise - The promise to race.
 * @param signal - The abort signal.
 * @returns The result of the promise.
 */
export declare function raceWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T>;
//#endregion
//# sourceMappingURL=signal.d.ts.map