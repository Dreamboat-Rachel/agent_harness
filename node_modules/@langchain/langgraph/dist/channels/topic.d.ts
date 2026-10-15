import { BaseChannel } from "./base.js";

//#region src/channels/topic.d.ts
/** JS Topic checkpoint when `unique` is set: `[seen, values]`. */
type UniqueTopicCheckpoint<Value> = [Value[], Value[]];
/**
 * A configurable PubSub Topic.
 */
declare class Topic<Value> extends BaseChannel<Array<Value>, Value | Value[], Value[] | UniqueTopicCheckpoint<Value>> {
  lc_graph_name: string;
  unique: boolean;
  accumulate: boolean;
  seen: Set<Value>;
  values: Value[];
  constructor(fields?: {
    /**
     * Whether to only add unique values to the topic. If `true`, only unique values (using reference equality) will be added to the topic.
     */
    unique?: boolean;
    /**
     * Whether to accumulate values across steps. If `false`, the channel will be emptied after each step.
     */
    accumulate?: boolean;
  });
  fromCheckpoint(checkpoint?: Value[] | UniqueTopicCheckpoint<Value>): this;
  update(values: Array<Value | Value[]>): boolean;
  get(): Array<Value>;
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
  checkpoint(): Value[] | UniqueTopicCheckpoint<Value>;
  isAvailable(): boolean;
}
//#endregion
export { Topic };
//# sourceMappingURL=topic.d.ts.map