import { GraphCallbackHandler } from "../callbacks.js";
//#region src/pregel/callbacks.ts
function getGraphCallbackDispatcher(manager) {
	const handlers = manager?.handlers.filter(GraphCallbackHandler.isInstance);
	if (!handlers?.length) return void 0;
	return async (events) => {
		while (events?.length) {
			const event = events.shift();
			for (const handler of handlers) {
				const method = "interrupts" in event ? "handleInterrupt" : "handleResume";
				try {
					if ("interrupts" in event) await handler.handleInterrupt?.(event);
					else await handler.handleResume?.(event);
				} catch (error) {
					(handler.raiseError ? console.error : console.warn)(`Error in handler ${handler.constructor.name}, ${method}: ${error}`);
					if (handler.raiseError) throw error;
				}
			}
		}
	};
}
//#endregion
export { getGraphCallbackDispatcher };

//# sourceMappingURL=callbacks.js.map