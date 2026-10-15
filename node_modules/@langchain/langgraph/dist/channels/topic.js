import { EmptyChannelError } from "../errors.js";
import { BaseChannel } from "./base.js";
//#region src/channels/topic.ts
/**
* Detect the `[seen, values]` Topic checkpoint shape.
*
* Used for `unique: true` topics (current) and pre-flat JS checkpoints
* (legacy). Flat Python-parity checkpoints are a single values list.
*/
function isUniqueTopicCheckpoint(checkpoint) {
	return Array.isArray(checkpoint) && checkpoint.length === 2 && Array.isArray(checkpoint[0]) && Array.isArray(checkpoint[1]);
}
/**
* A configurable PubSub Topic.
*/
var Topic = class Topic extends BaseChannel {
	lc_graph_name = "Topic";
	unique = false;
	accumulate = false;
	seen;
	values;
	constructor(fields) {
		super();
		this.unique = fields?.unique ?? this.unique;
		this.accumulate = fields?.accumulate ?? this.accumulate;
		this.seen = /* @__PURE__ */ new Set();
		this.values = [];
	}
	fromCheckpoint(checkpoint) {
		const empty = new Topic({
			unique: this.unique,
			accumulate: this.accumulate
		});
		if (typeof checkpoint === "undefined") return empty;
		if (isUniqueTopicCheckpoint(checkpoint)) {
			empty.seen = new Set(checkpoint[0]);
			empty.values = [...checkpoint[1]];
			return empty;
		}
		empty.values = [...checkpoint];
		if (this.unique) empty.seen = new Set(empty.values);
		return empty;
	}
	update(values) {
		let updated = false;
		if (!this.accumulate) {
			updated = this.values.length > 0;
			this.values = [];
		}
		const flatValues = values.flat();
		if (flatValues.length > 0) if (this.unique) {
			for (const value of flatValues) if (!this.seen.has(value)) {
				updated = true;
				this.seen.add(value);
				this.values.push(value);
			}
		} else {
			updated = true;
			this.values.push(...flatValues);
		}
		return updated;
	}
	get() {
		if (this.values.length === 0) throw new EmptyChannelError();
		return this.values;
	}
	/**
	* Checkpoint Topic state.
	*
	* Default / Host path (`unique: false`, including `__pregel_tasks`): flat
	* values list, matching Python Topic. Previously this always returned
	* `[seen, values]`, so empty TASKS became `[[], []]` and Host's Python
	* checkpointer rejected it.
	*
	* When `unique: true`, keep `[seen, values]` so dedupe history that outlives
	* the current buffer still survives resume.
	*/
	checkpoint() {
		if (this.unique) return [[...this.seen], [...this.values]];
		return [...this.values];
	}
	isAvailable() {
		return this.values.length !== 0;
	}
};
//#endregion
export { Topic };

//# sourceMappingURL=topic.js.map