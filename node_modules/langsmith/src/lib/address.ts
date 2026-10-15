/**
 * (beta) Addresses that name where runs are sent instead of a project.
 * Enabled per workspace; a workspace without it rejects the runs.
 *
 * An `Address` names a tracing project held by a feature: an `AgentAddress`, an
 * `ExperimentAddress` or the workspace's `EvaluatorAddress`. Any of them can be resolved to
 * its project. Only an `AgentAddress` can receive traces, and ingestion rejects the
 * others at its entry points.
 *
 * @example
 * ```ts
 * import { AgentAddress, traceable } from "langsmith";
 *
 * const support = new AgentAddress("customer-support", "production");
 * const handle = traceable(fn, { address: support });
 * ```
 */
import { getEnvironmentVariable } from "./utils/env.js";

/** (beta) An agent environment. */
export type Environment = "local" | "development" | "staging" | "production";

/**
 * @internal The wire identifier, `lrn:agents/{id}/environments/{environment}`,
 * typed as a template literal so a literal is checked at compile time.
 */
export type Lrn = `lrn:agents/${string}/environments/${Environment}`;

/** (beta) The address of an agent's environment. */
export interface AgentAddress {
  kind: "AGENT";
  id: string;
  environment: Uppercase<Environment>;
}

/** (beta) Construct and validate an agent address; plain objects are also accepted. */
export class AgentAddress {
  constructor(id: string, environment: Environment | (string & {})) {
    const address = ensureAgent({ kind: "AGENT", id, environment });
    this.kind = address.kind;
    this.id = address.id;
    this.environment = address.environment;
    Object.freeze(this);
  }
}

/** (beta) The address of an experiment's tracing project. */
export interface ExperimentAddress {
  kind: "EXPERIMENT";
  id: string;
}

/** (beta) Construct and validate an experiment address. */
export class ExperimentAddress {
  constructor(id: string) {
    const address = ensureAddress({ kind: "EXPERIMENT", id });
    this.kind = address.kind;
    this.id = address.id;
    Object.freeze(this);
  }
}

/** (beta) The address of the workspace's shared evaluators project. */
export interface EvaluatorAddress {
  kind: "EVALUATOR";
}

/** (beta) Construct the workspace's evaluators address. */
export class EvaluatorAddress {
  constructor() {
    this.kind = "EVALUATOR";
    Object.freeze(this);
  }
}

/** (beta) A feature that holds traces in a tracing project. */
export type Address = AgentAddress | ExperimentAddress | EvaluatorAddress;

/** (beta) An address as the resolve endpoint takes it. */
export type ApiAddress = Address;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The server's agent id rule: a DNS label, so a hostname can carry the id.
const AGENT_ID_PATTERN = /^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;
const ENVIRONMENTS = ["local", "development", "staging", "production"];

// The wire form of an agent address. The parts are validated at entrypoints.
const LRN_PATTERN = /^lrn:agents\/([^/]+)\/environments\/([^/]+)$/;

const ENV_NAMES = ["LANGSMITH_AGENT_ID", "LANGSMITH_AGENT_ENVIRONMENT"];

/** (beta) The `LANGSMITH_AGENT_*` / project env vars name half an address, or both. */
export class EnvAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvAddressError";
  }
}

/** Validate an address at an SDK entrypoint and return a normalized copy. */
export function ensureAddress<K extends Address["kind"]>(value: {
  kind: K;
  id?: unknown;
  environment?: unknown;
}): Extract<Address, { kind: K }>;
export function ensureAddress(value: unknown): Address | undefined;
export function ensureAddress(value: unknown): Address | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object") {
    throw new Error(
      "address must be an AgentAddress, ExperimentAddress or EvaluatorAddress object.",
    );
  }
  const { kind, id, environment } = value as Record<string, unknown>;
  if (kind === "EVALUATOR") return { kind };
  if (kind === "EXPERIMENT") {
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      throw new Error(
        `Experiment id must be a UUID, got ${JSON.stringify(id)}.`,
      );
    }
    return { kind, id: id.toLowerCase() };
  }
  if (kind !== "AGENT") {
    throw new Error(
      "address must be an AgentAddress, ExperimentAddress or EvaluatorAddress object.",
    );
  }
  if (typeof id !== "string" || !AGENT_ID_PATTERN.test(id)) {
    throw new Error(
      "Address agent id must be 1 to 63 lowercase ASCII letters, digits, or " +
        "hyphens, start with a letter, and end with a letter or digit, got " +
        `${JSON.stringify(id)}. Use an id such as "support-agent".`,
    );
  }
  const normalized =
    typeof environment === "string" ? environment.toLowerCase() : undefined;
  if (normalized === undefined || !ENVIRONMENTS.includes(normalized)) {
    throw new Error(
      `Address environment must be one of ${ENVIRONMENTS.join(
        ", ",
      )}, got ${JSON.stringify(environment)}.`,
    );
  }
  return {
    kind,
    id,
    environment: normalized.toUpperCase() as Uppercase<Environment>,
  };
}

/** @internal Only agent addresses can receive traces. */
export function ensureAgent(value: {
  kind: "AGENT";
  id?: unknown;
  environment?: unknown;
}): AgentAddress;
export function ensureAgent(value: unknown): AgentAddress | undefined;
export function ensureAgent(value: unknown): AgentAddress | undefined {
  const address = ensureAddress(value);
  if (address && address.kind !== "AGENT") {
    throw new Error(
      `Only an AgentAddress can receive traces, got ${address.kind}.`,
    );
  }
  return address;
}

/** @internal Convert a validated address to the ingestion wire format. */
export function addressToLrn(address: AgentAddress): Lrn {
  return `lrn:agents/${address.id}/environments/${
    address.environment.toLowerCase() as Environment
  }`;
}

/** @internal Parse and validate an address from untrusted wire data. */
export function addressFromLrn(value: unknown): AgentAddress {
  const match = typeof value === "string" ? LRN_PATTERN.exec(value) : null;
  if (!match) throw new Error("Not an agent address.");
  return ensureAgent({ kind: "AGENT", id: match[1], environment: match[2] });
}

/** @internal Read and validate the address named by environment variables. */
export function addressFromEnv(): AgentAddress | undefined {
  const values = ENV_NAMES.map((name) => getEnvironmentVariable(name));
  if (!values.some(Boolean)) return undefined;
  try {
    const missing = ENV_NAMES.filter((_, i) => !values[i]);
    if (missing.length)
      throw new Error(`An address needs ${missing.join(" and ")} as well.`);
    return ensureAgent({
      kind: "AGENT",
      id: values[0],
      environment: values[1],
    });
  } catch (e) {
    throw new EnvAddressError(
      `The LANGSMITH_AGENT_* env vars can't address a run: ${
        (e as Error).message
      }`,
    );
  }
}

/** @internal The environment variable names an address reads. */
export function envNames(): string[] {
  return ENV_NAMES;
}
