import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { ns as ns$1 } from "../utils/namespace.js";
//#region src/errors/index.ts
var errors_exports = /* @__PURE__ */ __exportAll({
	ContextOverflowError: () => ContextOverflowError,
	LangChainError: () => LangChainError,
	ModelAbortError: () => ModelAbortError,
	addLangChainErrorFields: () => addLangChainErrorFields,
	getRetryable: () => getRetryable,
	ns: () => ns,
	stampRetryable: () => stampRetryable
});
/** @deprecated Subclass LangChainError instead */
function addLangChainErrorFields(error, lc_error_code) {
	error.lc_error_code = lc_error_code;
	error.message = `${error.message}\n\nTroubleshooting URL: https://docs.langchain.com/oss/javascript/langchain/errors/${lc_error_code}/\n`;
	return error;
}
/** The error namespace for all LangChain errors */
const ns = ns$1.sub("error");
/** Registered globally so duplicate copies of core in one dependency tree agree. */
const retryableSymbol = Symbol.for("langchain.errors.retryable");
/**
* Mark an error as safe or unsafe to retry.
*
* Sets a non-enumerable symbol on the error itself, leaving its class and
* shape untouched, so it is safe to apply to a provider SDK's own error.
*
* @param error - The error to mark. Non-objects are returned untouched.
* @param retryable - `true` if retrying may succeed.
* @returns The same error instance, for chaining.
*/
function stampRetryable(error, retryable) {
	if (typeof error !== "object" || error === null) return error;
	try {
		Object.defineProperty(error, retryableSymbol, {
			value: retryable,
			configurable: true
		});
	} catch {}
	return error;
}
/**
* Read an error's retryability mark.
*
* @returns `true`/`false` when marked, `undefined` when unclassified —
*   supply your own default, e.g. `getRetryable(error) ?? true`.
*/
function getRetryable(error) {
	if (typeof error !== "object" || error === null) return;
	return Object.getOwnPropertyDescriptor(error, retryableSymbol)?.value;
}
/**
* Base error class for all LangChain errors.
*
* All LangChain error classes should extend this class (directly or
* indirectly). Use `LangChainError.isInstance(obj)` to check if an
* object is any LangChain error.
*
* @example
* ```typescript
* try {
*   await model.invoke("hello");
* } catch (error) {
*   if (LangChainError.isInstance(error)) {
*     console.log("Got a LangChain error:", error.message);
*   }
* }
* ```
*/
var LangChainError = class extends ns.brand(Error) {
	name = "LangChainError";
	constructor(message) {
		super(message);
		if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
	}
};
/**
* Error class representing an aborted model operation in LangChain.
*
* This error is thrown when a model operation (such as invocation, streaming, or batching)
* is cancelled before it completes, commonly due to a user-initiated abort signal
* (e.g., via an AbortController) or an upstream cancellation event.
*
* The ModelAbortError provides access to any partial output the model may have produced
* before the operation was interrupted, which can be useful for resuming work, debugging,
* or presenting incomplete results to users.
*
* @remarks
* - The `partialOutput` field includes message content that was generated prior to the abort,
*   such as a partial AIMessageChunk.
* - This error extends the {@link LangChainError} base class with the marker `"model-abort"`.
*
* @example
* ```typescript
* try {
*   await model.invoke(input, { signal: abortController.signal });
* } catch (err) {
*   if (ModelAbortError.isInstance(err)) {
*     // Handle user cancellation, check err.partialOutput if needed
*   } else {
*     throw err;
*   }
* }
* ```
*/
var ModelAbortError = class extends ns.brand(LangChainError, "model-abort") {
	name = "ModelAbortError";
	/**
	* The partial message output that was produced before the operation was aborted.
	* This is typically an AIMessageChunk, or could be undefined if no output was available.
	*/
	partialOutput;
	/**
	* Constructs a new ModelAbortError instance.
	*
	* @param message - A human-readable message describing the abort event.
	* @param partialOutput - Any partial model output generated before the abort (optional).
	*/
	constructor(message, partialOutput) {
		super(message);
		this.partialOutput = partialOutput;
		stampRetryable(this, false);
	}
};
/**
* Error class representing a context window overflow in a language model operation.
*
* This error is thrown when the combined input to a language model (such as prompt tokens,
* historical messages, and/or instructions) exceeds the maximum context window or token limit
* that the model can process in a single request. Most models have defined upper limits for the number of
* tokens or characters allowed in a context, and exceeding this limit will prevent
* the operation from proceeding.
*
* The {@link ContextOverflowError} extends the {@link LangChainError} base class with
* the marker `"context-overflow"`.
*
* @remarks
* - Use this error to programmatically identify cases where a user request, prompt, or input
*   sequence is too long to be handled by the target model.
* - Model providers and framework integrations should throw this error if they detect
*   a request cannot be processed due to its size.
*
* @example
* ```typescript
* try {
*   await model.invoke(veryLongInput);
* } catch (err) {
*   if (ContextOverflowError.isInstance(err)) {
*     // Handle overflow, e.g., prompt user to shorten input or truncate text
*     console.warn("Model context overflow:", err.message);
*   } else {
*     throw err;
*   }
* }
* ```
*/
var ContextOverflowError = class ContextOverflowError extends ns.brand(LangChainError, "context-overflow") {
	name = "ContextOverflowError";
	/**
	* The underlying error that caused this {@link ContextOverflowError}, if any.
	*
	* This property is optionally set when wrapping a lower-level error using {@link ContextOverflowError.fromError}.
	* It allows error handlers to access or inspect the original error that led to the context overflow.
	*/
	cause;
	constructor(message) {
		super(message ?? "Input exceeded the model's context window.");
		stampRetryable(this, false);
	}
	/**
	* Creates a new {@link ContextOverflowError} instance from an existing error.
	*
	* This static utility copies the message from the provided error and
	* attaches the original error as the {@link ContextOverflowError.cause} property,
	* enabling error handlers to inspect or propagate the original failure.
	*
	* @param obj - The original error object causing the context overflow.
	* @returns A new {@link ContextOverflowError} instance with the original error set as its cause.
	*
	* @example
	* ```typescript
	* try {
	*   await model.invoke(input);
	* } catch (err) {
	*   throw ContextOverflowError.fromError(err);
	* }
	* ```
	*/
	static fromError(obj) {
		const error = new ContextOverflowError(obj.message);
		error.cause = obj;
		return error;
	}
};
//#endregion
export { ContextOverflowError, LangChainError, ModelAbortError, addLangChainErrorFields, errors_exports, getRetryable, ns, stampRetryable };

//# sourceMappingURL=index.js.map