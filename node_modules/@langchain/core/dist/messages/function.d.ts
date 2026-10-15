import { BaseMessage, BaseMessageChunk, BaseMessageFields } from "./base.js";
import { MessageStructure, MessageToolSet } from "./message.js";
//#region src/messages/function.d.ts
export interface FunctionMessageFields<TStructure extends MessageStructure = MessageStructure> extends BaseMessageFields<TStructure, "function"> {
  name: string;
}
/**
 * Represents a function message in a conversation.
 */
export declare class FunctionMessage<TStructure extends MessageStructure = MessageStructure> extends BaseMessage<TStructure, "function"> implements FunctionMessageFields<TStructure> {
  static lc_name(): string;
  readonly type: "function";
  name: string;
  constructor(fields: FunctionMessageFields<TStructure>);
  static isInstance(obj: unknown): obj is FunctionMessage;
  static [Symbol.hasInstance](obj: unknown): obj is FunctionMessage<MessageStructure<MessageToolSet>>;
}
/**
 * Represents a chunk of a function message, which can be concatenated
 * with other function message chunks.
 */
export declare class FunctionMessageChunk<TStructure extends MessageStructure = MessageStructure> extends BaseMessageChunk<TStructure, "function"> {
  static lc_name(): string;
  readonly type: "function";
  concat(chunk: FunctionMessageChunk<TStructure>): this;
  static isInstance(obj: unknown): obj is FunctionMessageChunk;
  static [Symbol.hasInstance](obj: unknown): obj is FunctionMessageChunk<MessageStructure<MessageToolSet>>;
}
export declare function isFunctionMessage(x: BaseMessage): x is FunctionMessage;
export declare function isFunctionMessageChunk(x: BaseMessageChunk): x is FunctionMessageChunk;
//#endregion
//# sourceMappingURL=function.d.ts.map