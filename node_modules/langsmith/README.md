# LangSmith Client SDK

![NPM Version](https://img.shields.io/npm/v/langsmith?logo=npm)
[![JS Downloads](https://img.shields.io/npm/dm/langsmith)](https://www.npmjs.com/package/langsmith)

This package contains the TypeScript client for interacting with the [LangSmith platform](https://smith.langchain.com/).

To install:

```bash
pnpm add langsmith
```

LangSmith helps you and your team develop and evaluate language models and intelligent agents. It is compatible with any LLM Application and provides seamless integration with [LangChain](https://github.com/hwchase17/langchainjs), a widely recognized open-source framework that simplifies the process for developers to create powerful language model applications.

> **Note**: You can enjoy the benefits of LangSmith without using the LangChain open-source packages! To get started with your own proprietary framework, set up your account and then skip to [Logging Traces Outside LangChain](#logging-traces-outside-langchain).

> **Cookbook:** For tutorials on how to get more value out of LangSmith, check out the [Langsmith Cookbook](https://github.com/langchain-ai/langsmith-cookbook/tree/main) repo.

A typical workflow looks like:

1. Set up an account with LangSmith.
2. Log traces.
3. Debug, Create Datasets, and Evaluate Runs.

We'll walk through these steps in more detail below.

## 1. Connect to LangSmith

Sign up for [LangSmith](https://smith.langchain.com/) using your GitHub, Discord accounts, or an email address and password. If you sign up with an email, make sure to verify your email address before logging in.

Then, create a unique API key on the [Settings Page](https://smith.langchain.com/settings).

> [!NOTE]
> Save the API Key in a secure location. It will not be shown again.

## 2. Log Traces

You can log traces natively in your LangChain application or using a LangSmith RunTree.

### Logging Traces with LangChain

LangSmith seamlessly integrates with the JavaScript LangChain library to record traces from your LLM applications.

```bash
pnpm add langchain
```

1. **Copy the environment variables from the Settings Page and add them to your application.**

Tracing can be activated by setting the following environment variables or by manually specifying the LangChainTracer.

```typescript
process.env.LANGSMITH_TRACING = 'true';
process.env.LANGSMITH_ENDPOINT = 'https://api.smith.langchain.com';
// process.env.LANGSMITH_ENDPOINT = "https://eu.api.smith.langchain.com"; // If signed up in the EU region
process.env.LANGSMITH_API_KEY = '<YOUR-LANGSMITH-API-KEY>';
// process.env.LANGSMITH_PROJECT = "My Project Name"; // Optional: "default" is used if not set
// process.env.LANGSMITH_WORKSPACE_ID = "<YOUR-WORKSPACE-ID>"; // Required for org-scoped API keys
```

> **Tip:** Projects are groups of traces. All runs are logged to a project. If not specified, the project is set to `default`.

2. **Run an Agent, Chain, or Language Model in LangChain**

If the environment variables are correctly set, your application will automatically connect to the LangSmith platform.

```typescript
import { ChatOpenAI } from 'langchain/chat_models/openai';

const chat = new ChatOpenAI({ temperature: 0 });
const response = await chat.predict('Translate this sentence from English to French. I love programming.');
console.log(response);
```

### Logging Traces Outside LangChain

You can still use the LangSmith development platform without depending on any
LangChain code. You can connect either by setting the appropriate environment variables,
or by directly specifying the connection information in the RunTree.

1. **Copy the environment variables from the Settings Page and add them to your application.**

```shell
export LANGSMITH_TRACING="true";
export LANGSMITH_API_KEY=<YOUR-LANGSMITH-API-KEY>
# export LANGSMITH_PROJECT="My Project Name" #  Optional: "default" is used if not set
# export LANGSMITH_ENDPOINT=https://api.smith.langchain.com # or your own server
```

## Integrations

Langsmith's `traceable` wrapper function makes it easy to trace any function or LLM call in your own favorite framework. Below are some examples.

### OpenAI SDK

<!-- markdown-link-check-disable -->

The easiest way to trace calls from the [OpenAI SDK](https://platform.openai.com/docs/api-reference) with LangSmith
is using the `wrapOpenAI` wrapper function available in LangSmith 0.1.3 and up.

In order to use, you first need to set your LangSmith API key:

```shell
export LANGSMITH_TRACING="true";
export LANGSMITH_API_KEY=<your-api-key>
```

Next, you will need to install the LangSmith SDK and the OpenAI SDK:

```shell
npm install langsmith openai
```

After that, initialize your OpenAI client and wrap the client with `wrapOpenAI` method to enable tracing for the completions and chat completions methods:

```ts
import { OpenAI } from 'openai';
import { wrapOpenAI } from 'langsmith/wrappers';

const openai = wrapOpenAI(new OpenAI());

await openai.chat.completions.create({
  model: 'gpt-5.4',
  messages: [{ content: 'Hi there!', role: 'user' }],
});
```

Alternatively, you can use the `traceable` function to wrap the client methods you want to use:

```ts
import { traceable } from 'langsmith/traceable';

const openai = new OpenAI();

const createCompletion = traceable(openai.chat.completions.create.bind(openai.chat.completions), {
  name: 'OpenAI Chat Completion',
  run_type: 'llm',
});

await createCompletion({
  model: 'gpt-5.4',
  messages: [{ content: 'Hi there!', role: 'user' }],
});
```

Note the use of `.bind` to preserve the function's context. The `run_type` field in the
extra config object marks the function as an LLM call, and enables token usage tracking
for OpenAI.

Oftentimes, you use the OpenAI client inside of other functions or as part of a longer
sequence. You can automatically get nested traces by using this wrapped method
within other functions wrapped with `traceable`.

```ts
const nestedTrace = traceable(async (text: string) => {
  const completion = await openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: [{ content: text, role: 'user' }],
  });
  return completion;
});

await nestedTrace('Why is the sky blue?');
```

```
{
  "id": "chatcmpl-8sPToJQLLVepJvyeTfzZMOMVIKjMo",
  "object": "chat.completion",
  "created": 1707978348,
  "model": "gpt-5.4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The sky appears blue because of a phenomenon known as Rayleigh scattering. The Earth's atmosphere is composed of tiny molecules, such as nitrogen and oxygen, which are much smaller than the wavelength of visible light. When sunlight interacts with these molecules, it gets scattered in all directions. However, shorter wavelengths of light (blue and violet) are scattered more compared to longer wavelengths (red, orange, and yellow). \n\nAs a result, when sunlight passes through the Earth's atmosphere, the blue and violet wavelengths are scattered in all directions, making the sky appear blue. This scattering of shorter wavelengths is also responsible for the vibrant colors observed during sunrise and sunset, when the sunlight has to pass through a thicker portion of the atmosphere, causing the longer wavelengths to dominate the scattered light."
      },
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 13,
    "completion_tokens": 154,
    "total_tokens": 167
  },
  "system_fingerprint": null
}
```

:::tip
[Click here](https://smith.langchain.com/public/4af46ef6-b065-46dc-9cf0-70f1274edb01/r) to see an example LangSmith trace of the above.
:::

## Next.js

You can use the `traceable` wrapper function in Next.js apps to wrap arbitrary functions much like in the example above.

One neat trick you can use for Next.js and other similar server frameworks is to wrap the entire exported handler for a route
to group traces for the any sub-runs. Here's an example:

```ts
import { NextRequest, NextResponse } from 'next/server';

import { OpenAI } from 'openai';
import { traceable } from 'langsmith/traceable';
import { wrapOpenAI } from 'langsmith/wrappers';

export const runtime = 'edge';

const handler = traceable(
  async function () {
    const openai = wrapOpenAI(new OpenAI());

    const completion = await openai.chat.completions.create({
      model: 'gpt-5.4',
      messages: [{ content: 'Why is the sky blue?', role: 'user' }],
    });

    const response1 = completion.choices[0].message.content;

    const completion2 = await openai.chat.completions.create({
      model: 'gpt-5.4',
      messages: [
        { content: 'Why is the sky blue?', role: 'user' },
        { content: response1, role: 'assistant' },
        { content: 'Cool thank you!', role: 'user' },
      ],
    });

    const response2 = completion2.choices[0].message.content;

    return {
      text: response2,
    };
  },
  {
    name: 'Simple Next.js handler',
  },
);

export async function POST(req: NextRequest) {
  const result = await handler();
  return NextResponse.json(result);
}
```

The two OpenAI calls within the handler will be traced with appropriate inputs, outputs,
and token usage information.

:::tip
[Click here](https://smith.langchain.com/public/faaf26ad-8c59-4622-bcfe-b7d896733ca6/r) to see an example LangSmith trace of the above.
:::

## Vercel AI SDK

The [Vercel AI SDK](https://sdk.vercel.ai/docs) contains integrations with a variety of model providers.
Here's an example of how you can trace outputs in a Next.js handler:

```ts
import { traceable } from 'langsmith/traceable';
import { OpenAIStream, StreamingTextResponse } from 'ai';

// Note: There are no types for the Mistral API client yet.
import MistralClient from '@mistralai/mistralai';

const client = new MistralClient(process.env.MISTRAL_API_KEY || '');

export async function POST(req: Request) {
  // Extract the `messages` from the body of the request
  const { messages } = await req.json();

  const mistralChatStream = traceable(client.chatStream.bind(client), {
    name: 'Mistral Stream',
    run_type: 'llm',
  });

  const response = await mistralChatStream({
    model: 'mistral-tiny',
    maxTokens: 1000,
    messages,
  });

  // Convert the response into a friendly text-stream. The Mistral client responses are
  // compatible with the Vercel AI SDK OpenAIStream adapter.
  const stream = OpenAIStream(response as any);

  // Respond with the stream
  return new StreamingTextResponse(stream);
}
```

See the [AI SDK docs](https://sdk.vercel.ai/docs) for more examples.

## Arbitrary SDKs

You can use the generic `wrapSDK` method to add tracing for arbitrary SDKs.

Do note that this will trace ALL methods in the SDK, not just chat completion endpoints.
If the SDK you are wrapping has other methods, we recommend using it for only LLM calls.

Here's an example using the Anthropic SDK:

```ts
import { wrapSDK } from 'langsmith/wrappers';
import { Anthropic } from '@anthropic-ai/sdk';

const originalSDK = new Anthropic();
const sdkWithTracing = wrapSDK(originalSDK);

const response = await sdkWithTracing.messages.create({
  messages: [
    {
      role: 'user',
      content: `What is 1 + 1? Respond only with "2" and nothing else.`,
    },
  ],
  model: 'claude-3-sonnet-20240229',
  max_tokens: 1024,
});
```

:::tip
[Click here](https://smith.langchain.com/public/0e7248af-bbed-47cf-be9f-5967fea1dec1/r) to see an example LangSmith trace of the above.
:::

#### Alternatives: **Log traces using a RunTree.**

A RunTree tracks your application. Each RunTree object is required to have a name and run_type. These and other important attributes are as follows:

- `name`: `string` - used to identify the component's purpose
- `run_type`: `string` - Currently one of "llm", "chain" or "tool"; more options will be added in the future
- `inputs`: `Record<string, any>` - the inputs to the component
- `outputs`: `Optional<Record<string, any>>` - the (optional) returned values from the component
- `error`: `Optional<string>` - Any error messages that may have arisen during the call

```typescript
import { RunTree, RunTreeConfig } from 'langsmith';

const parentRunConfig: RunTreeConfig = {
  name: 'My Chat Bot',
  run_type: 'chain',
  inputs: {
    text: "Summarize this morning's meetings.",
  },
  serialized: {}, // Serialized representation of this chain
  // project_name: "Defaults to the LANGSMITH_PROJECT env var"
  // apiUrl: "Defaults to the LANGSMITH_ENDPOINT env var"
  // apiKey: "Defaults to the LANGSMITH_API_KEY env var"
};

const parentRun = new RunTree(parentRunConfig);

await parentRun.postRun();

const childLlmRun = await parentRun.createChild({
  name: 'My Proprietary LLM',
  run_type: 'llm',
  inputs: {
    prompts: ['You are an AI Assistant. The time is XYZ.' + " Summarize this morning's meetings."],
  },
});

await childLlmRun.postRun();

await childLlmRun.end({
  outputs: {
    generations: ['I should use the transcript_loader tool' + ' to fetch meeting_transcripts from XYZ'],
  },
});

await childLlmRun.patchRun();

const childToolRun = await parentRun.createChild({
  name: 'transcript_loader',
  run_type: 'tool',
  inputs: {
    date: 'XYZ',
    content_type: 'meeting_transcripts',
  },
});
await childToolRun.postRun();

await childToolRun.end({
  outputs: {
    meetings: ['Meeting1 notes..'],
  },
});

await childToolRun.patchRun();

const childChainRun = await parentRun.createChild({
  name: 'Unreliable Component',
  run_type: 'tool',
  inputs: {
    input: 'Summarize these notes...',
  },
});

await childChainRun.postRun();

try {
  // .... the component does work
  throw new Error('Something went wrong');
} catch (e) {
  await childChainRun.end({
    error: `I errored again ${e.message}`,
  });
  await childChainRun.patchRun();
  throw e;
}

await childChainRun.patchRun();

await parentRun.end({
  outputs: {
    output: ['The meeting notes are as follows:...'],
  },
});

// False directs to not exclude child runs
await parentRun.patchRun();
```

## Evaluation

#### Create a Dataset from Existing Runs

Once your runs are stored in LangSmith, you can convert them into a dataset.
For this example, we will do so using the Client, but you can also do this using
the web interface, as explained in the [LangSmith docs](https://docs.smith.langchain.com/docs/).

```typescript
import { Client } from 'langsmith/client';
const client = new Client({
  // apiUrl: "https://api.langchain.com", // Defaults to the LANGSMITH_ENDPOINT env var
  // apiKey: "my_api_key", // Defaults to the LANGSMITH_API_KEY env var
  /* callerOptions: {
         maxConcurrency?: Infinity; // Maximum number of concurrent requests to make
         maxRetries?: 6; // Maximum number of retries to make
    */
});
const datasetName = 'Example Dataset';
// We will only use examples from the top level AgentExecutor run here,
// and exclude runs that errored.
const runs = await client.listRuns({
  projectName: 'my_project',
  executionOrder: 1,
  error: false,
});

const dataset = await client.createDataset(datasetName, {
  description: 'An example dataset',
});

for (const run of runs) {
  await client.createExample(run.inputs, run.outputs ?? {}, {
    datasetId: dataset.id,
  });
}
```

## Additional Documentation

To learn more about the LangSmith platform, check out the [docs](https://docs.smith.langchain.com/docs/).

# Generated REST client

The low-level, generated client (`Langsmith`) ships in the same package. Everything below is maintained by Stainless.

## Installation

```sh
npm install git+ssh://git@github.com:langchain-ai/langsmith-javascript.git
```

> [!NOTE]
> Once this package is [published to npm](https://www.stainless.com/docs/guides/publish), this will become: `npm install langsmith`

## Usage

The full API of this library can be found in [api.md](api.md).

<!-- prettier-ignore -->
```js
import Langsmith from 'langsmith';

const client = new Langsmith({
  apiKey: process.env['LANGSMITH_API_KEY'], // This is the default and can be omitted
  tenantID: process.env['LANGSMITH_TENANT_ID'], // This is the default and can be omitted
});

const page = await client.runs.queryV2({ project_ids: ['00000000-0000-0000-0000-000000000000'] });
const run = page.items[0];

console.log(run.id);
```

### Request & Response types

This library includes TypeScript definitions for all request params and response fields. You may import and use them like so:

<!-- prettier-ignore -->
```ts
import Langsmith from 'langsmith';

const client = new Langsmith({
  apiKey: process.env['LANGSMITH_API_KEY'], // This is the default and can be omitted
  tenantID: process.env['LANGSMITH_TENANT_ID'], // This is the default and can be omitted
});

const params: Langsmith.RunQueryV2Params = {
  project_ids: ['00000000-0000-0000-0000-000000000000'],
};
const [run]: [Langsmith.Run] = await client.runs.queryV2(params);
```

Documentation for each method, request param, and response field are available in docstrings and will appear on hover in most modern editors.

## Handling errors

When the library is unable to connect to the API,
or if the API returns a non-success status code (i.e., 4xx or 5xx response),
a subclass of `APIError` will be thrown:

<!-- prettier-ignore -->
```ts
const page = await client.runs
  .queryV2({ project_ids: ['00000000-0000-0000-0000-000000000000'] })
  .catch(async (err) => {
    if (err instanceof Langsmith.APIError) {
      console.log(err.status); // 400
      console.log(err.name); // BadRequestError
      console.log(err.headers); // {server: 'nginx', ...}
    } else {
      throw err;
    }
  });
```

Error codes are as follows:

| Status Code | Error Type                 |
| ----------- | -------------------------- |
| 400         | `BadRequestError`          |
| 401         | `AuthenticationError`      |
| 403         | `PermissionDeniedError`    |
| 404         | `NotFoundError`            |
| 422         | `UnprocessableEntityError` |
| 429         | `RateLimitError`           |
| >=500       | `InternalServerError`      |
| N/A         | `APIConnectionError`       |

### Retries

Certain errors will be automatically retried 2 times by default, with a short exponential backoff.
Connection errors (for example, due to a network connectivity problem), 408 Request Timeout, 409 Conflict,
429 Rate Limit, and >=500 Internal errors will all be retried by default.

You can use the `maxRetries` option to configure or disable this:

<!-- prettier-ignore -->
```js
// Configure the default for all requests:
const client = new Langsmith({
  maxRetries: 0, // default is 2
});

// Or, configure per-request:
await client.runs.queryV2({ project_ids: ['00000000-0000-0000-0000-000000000000'] }, {
  maxRetries: 5,
});
```

### Timeouts

Requests time out after 1.5 minutes by default. You can configure this with a `timeout` option:

<!-- prettier-ignore -->
```ts
// Configure the default for all requests:
const client = new Langsmith({
  timeout: 20 * 1000, // 20 seconds (default is 1.5 minutes)
});

// Override per-request:
await client.runs.queryV2({ project_ids: ['00000000-0000-0000-0000-000000000000'] }, {
  timeout: 5 * 1000,
});
```

On timeout, an `APIConnectionTimeoutError` is thrown.

Note that requests which time out will be [retried twice by default](#retries).

## Auto-pagination

List methods in the Langsmith API are paginated.
You can use the `for await … of` syntax to iterate through items across all pages:

```ts
async function fetchAllRuns(params) {
  const allRuns = [];
  // Automatically fetches more pages as needed.
  for await (const run of client.runs.queryV2({
    project_ids: ['00000000-0000-0000-0000-000000000000'],
  })) {
    allRuns.push(run);
  }
  return allRuns;
}
```

Alternatively, you can request a single page at a time:

```ts
let page = await client.runs.queryV2({ project_ids: ['00000000-0000-0000-0000-000000000000'] });
for (const run of page.items) {
  console.log(run);
}

// Convenience methods are provided for manually paginating:
while (page.hasNextPage()) {
  page = await page.getNextPage();
  // ...
}
```

## Advanced Usage

### Accessing raw Response data (e.g., headers)

The "raw" `Response` returned by `fetch()` can be accessed through the `.asResponse()` method on the `APIPromise` type that all methods return.
This method returns as soon as the headers for a successful response are received and does not consume the response body, so you are free to write custom parsing or streaming logic.

You can also use the `.withResponse()` method to get the raw `Response` along with the parsed data.
Unlike `.asResponse()` this method consumes the body, returning once it is parsed.

<!-- prettier-ignore -->
```ts
const client = new Langsmith();

const response = await client.runs
  .queryV2({ project_ids: ['00000000-0000-0000-0000-000000000000'] })
  .asResponse();
console.log(response.headers.get('X-My-Header'));
console.log(response.statusText); // access the underlying Response object

const { data: page, response: raw } = await client.runs
  .queryV2({ project_ids: ['00000000-0000-0000-0000-000000000000'] })
  .withResponse();
console.log(raw.headers.get('X-My-Header'));
for await (const run of page) {
  console.log(run.id);
}
```

### Logging

> [!IMPORTANT]
> All log messages are intended for debugging only. The format and content of log messages
> may change between releases.

#### Log levels

The log level can be configured in two ways:

1. Via the `LANGCHAIN_LOG` environment variable
2. Using the `logLevel` client option (overrides the environment variable if set)

```ts
import Langsmith from 'langsmith';

const client = new Langsmith({
  logLevel: 'debug', // Show all log messages
});
```

Available log levels, from most to least verbose:

- `'debug'` - Show debug messages, info, warnings, and errors
- `'info'` - Show info messages, warnings, and errors
- `'warn'` - Show warnings and errors (default)
- `'error'` - Show only errors
- `'off'` - Disable all logging

At the `'debug'` level, all HTTP requests and responses are logged, including headers and bodies.
Some authentication-related headers are redacted, but sensitive data in request and response bodies
may still be visible.

#### Custom logger

By default, this library logs to `globalThis.console`. You can also provide a custom logger.
Most logging libraries are supported, including [pino](https://www.npmjs.com/package/pino), [winston](https://www.npmjs.com/package/winston), [bunyan](https://www.npmjs.com/package/bunyan), [consola](https://www.npmjs.com/package/consola), [signale](https://www.npmjs.com/package/signale), and [@std/log](https://jsr.io/@std/log). If your logger doesn't work, please open an issue.

When providing a custom logger, the `logLevel` option still controls which messages are emitted, messages
below the configured level will not be sent to your logger.

```ts
import Langsmith from 'langsmith';
import pino from 'pino';

const logger = pino();

const client = new Langsmith({
  logger: logger.child({ name: 'Langsmith' }),
  logLevel: 'debug', // Send all messages to pino, allowing it to filter
});
```

### Making custom/undocumented requests

This library is typed for convenient access to the documented API. If you need to access undocumented
endpoints, params, or response properties, the library can still be used.

#### Undocumented endpoints

To make requests to undocumented endpoints, you can use `client.get`, `client.post`, and other HTTP verbs.
Options on the client, such as retries, will be respected when making these requests.

```ts
await client.post('/some/path', {
  body: { some_prop: 'foo' },
  query: { some_query_arg: 'bar' },
});
```

#### Undocumented request params

To make requests using undocumented parameters, you may use `// @ts-expect-error` on the undocumented
parameter. This library doesn't validate at runtime that the request matches the type, so any extra values you
send will be sent as-is.

```ts
client.runs.queryV2({
  // ...
  // @ts-expect-error baz is not yet public
  baz: 'undocumented option',
});
```

For requests with the `GET` verb, any extra params will be in the query, all other requests will send the
extra param in the body.

If you want to explicitly send an extra argument, you can do so with the `query`, `body`, and `headers` request
options.

#### Undocumented response properties

To access undocumented response properties, you may access the response object with `// @ts-expect-error` on
the response object, or cast the response object to the requisite type. Like the request params, we do not
validate or strip extra properties from the response from the API.

### Customizing the fetch client

By default, this library expects a global `fetch` function is defined.

If you want to use a different `fetch` function, you can either polyfill the global:

```ts
import fetch from 'my-fetch';

globalThis.fetch = fetch;
```

Or pass it to the client:

```ts
import Langsmith from 'langsmith';
import fetch from 'my-fetch';

const client = new Langsmith({ fetch });
```

### Fetch options

If you want to set custom `fetch` options without overriding the `fetch` function, you can provide a `fetchOptions` object when instantiating the client or making a request. (Request-specific options override client options.)

```ts
import Langsmith from 'langsmith';

const client = new Langsmith({
  fetchOptions: {
    // `RequestInit` options
  },
});
```

#### Configuring proxies

To modify proxy behavior, you can provide custom `fetchOptions` that add runtime-specific proxy
options to requests:

<img src="https://raw.githubusercontent.com/stainless-api/sdk-assets/refs/heads/main/node.svg" align="top" width="18" height="21"> **Node** <sup>[[docs](https://github.com/nodejs/undici/blob/main/docs/docs/api/ProxyAgent.md#example---proxyagent-with-fetch)]</sup>

```ts
import Langsmith from 'langsmith';
import * as undici from 'undici';

const proxyAgent = new undici.ProxyAgent('http://localhost:8888');
const client = new Langsmith({
  fetchOptions: {
    dispatcher: proxyAgent,
  },
});
```

<img src="https://raw.githubusercontent.com/stainless-api/sdk-assets/refs/heads/main/bun.svg" align="top" width="18" height="21"> **Bun** <sup>[[docs](https://bun.sh/guides/http/proxy)]</sup>

```ts
import Langsmith from 'langsmith';

const client = new Langsmith({
  fetchOptions: {
    proxy: 'http://localhost:8888',
  },
});
```

<img src="https://raw.githubusercontent.com/stainless-api/sdk-assets/refs/heads/main/deno.svg" align="top" width="18" height="21"> **Deno** <sup>[[docs](https://docs.deno.com/api/deno/~/Deno.createHttpClient)]</sup>

```ts
import Langsmith from 'npm:langsmith';

const httpClient = Deno.createHttpClient({ proxy: { url: 'http://localhost:8888' } });
const client = new Langsmith({
  fetchOptions: {
    client: httpClient,
  },
});
```

### Sandbox AWS Auth Proxy

When sandbox code needs to call AWS services, use the sandbox AWS auth proxy.
The proxy keeps the real AWS credentials outside the sandbox and signs supported
AWS HTTPS requests with SigV4, so code in the sandbox can use AWS SDKs normally
without storing long-lived AWS keys in files, environment variables, shell
history, or logs.

Store AWS credentials as LangSmith workspace secrets using names that make sense
for your workspace. Then create the sandbox with an AWS auth proxy config:

```ts
import { SandboxClient, awsAuth, proxyConfig, workspaceSecret } from 'langsmith/sandbox';

const client = new SandboxClient();
const authConfig = proxyConfig({
  rules: [
    awsAuth({
      accessKeyId: workspaceSecret('SANDBOX_AWS_ACCESS_KEY_ID'),
      secretAccessKey: workspaceSecret('SANDBOX_AWS_SECRET_ACCESS_KEY'),
    }),
  ],
});

const sandbox = await client.createSandbox({
  name: 'aws-sandbox',
  proxyConfig: authConfig,
});

try {
  const result = await sandbox.run('node your-aws-script.js');
  console.log(result.stdout);
} finally {
  await sandbox.delete();
}
```

Use `opaqueSecret("...")` instead of `workspaceSecret(...)` when your application
needs to pass short-lived write-only AWS credentials at sandbox creation time.
Plaintext AWS credential values are not accepted directly; wrap them as
`opaqueSecret(...)` values.

### Sandbox GCP Auth Proxy

When sandbox code needs to call Google APIs, use the sandbox GCP auth proxy.
The proxy keeps the service account JSON outside the sandbox and injects OAuth
bearer tokens for Google API hosts matched automatically by the sandbox proxy.

Store the service account JSON as a LangSmith workspace secret. Then create the
sandbox with a GCP auth proxy config:

```ts
import { SandboxClient, gcpAuth, proxyConfig, workspaceSecret } from 'langsmith/sandbox';

const client = new SandboxClient();
const authConfig = proxyConfig({
  rules: [
    gcpAuth({
      serviceAccountJson: workspaceSecret('SANDBOX_GCP_SERVICE_ACCOUNT_JSON'),
      scopes: ['https://www.googleapis.com/auth/devstorage.read_write'],
    }),
  ],
});

const sandbox = await client.createSandbox({
  name: 'gcp-sandbox',
  proxyConfig: authConfig,
});

try {
  const result = await sandbox.run('node your-gcp-script.js');
  console.log(result.stdout);
} finally {
  await sandbox.delete();
}
```

Use `opaqueSecret("...")` for short-lived write-only service account JSON.
Plaintext service account JSON is not accepted directly.

### Sandbox Mounts

When you create a LangSmith sandbox that needs filesystem access to external
data such as object storage buckets or public Git repositories, pass a
`mountConfig` on sandbox creation. Mount specs contain only the mount target.
Provider credentials stay in `mountConfig.auth`; the backend expands them into
runtime proxy auth rules. You can also pass `proxyConfig` for non-mount proxy
behavior such as custom headers, callbacks, access control, and generic egress
rules. Explicit AWS/GCP proxy auth rules conflict with `mountConfig` auth for
the same provider.

S3 mounts require AWS auth:

```ts
import { awsAuth, mountConfig, s3Mount, workspaceSecret } from 'langsmith/sandbox';

const mountCfg = mountConfig({
  auth: [
    awsAuth({
      accessKeyId: workspaceSecret('SANDBOX_AWS_ACCESS_KEY_ID'),
      secretAccessKey: workspaceSecret('SANDBOX_AWS_SECRET_ACCESS_KEY'),
    }),
  ],
  mounts: [
    s3Mount({
      id: 'customer_data',
      mountPath: '/mnt/mounts/customer-data',
      bucket: 'example-bucket',
      prefix: 'datasets/customer-data',
      region: 'us-east-1',
      endpointUrl: 'https://s3.amazonaws.com',
      pathStyle: false,
      readOnly: false,
    }),
  ],
});

const sandbox = await client.createSandbox({
  name: 's3-mount-sandbox',
  mountConfig: mountCfg,
});

try {
  const result = await sandbox.run('ls /mnt/mounts/customer-data');
  console.log(result.stdout);
} finally {
  await sandbox.delete();
}
```

GCS mounts require GCP auth:

```ts
import { gcpAuth, gcsMount, mountConfig, workspaceSecret } from 'langsmith/sandbox';

const mountCfg = mountConfig({
  auth: [
    gcpAuth({
      serviceAccountJson: workspaceSecret('SANDBOX_GCP_SERVICE_ACCOUNT_JSON'),
    }),
  ],
  mounts: [
    gcsMount({
      id: 'customer_data',
      mountPath: '/mnt/mounts/customer-data',
      bucket: 'example-bucket',
      prefix: 'datasets/customer-data',
    }),
  ],
});

const sandbox = await client.createSandbox({
  name: 'gcs-mount-sandbox',
  mountConfig: mountCfg,
});

try {
  const result = await sandbox.run('ls /mnt/mounts/customer-data');
  console.log(result.stdout);
} finally {
  await sandbox.delete();
}
```

Public Git mounts do not require AWS or GCP auth:

```ts
import { gitMount, mountConfig } from 'langsmith/sandbox';

const mountCfg = mountConfig({
  mounts: [
    gitMount({
      id: 'repo',
      mountPath: '/mnt/repo',
      remoteUrl: 'https://github.com/langchain-ai/langsmith-javascript.git',
      ref: { type: 'branch', name: 'main' },
      refreshIntervalSeconds: 60,
    }),
  ],
});

const sandbox = await client.createSandbox({
  name: 'git-mount-sandbox',
  mountConfig: mountCfg,
});

try {
  const result = await sandbox.run('ls /mnt/repo');
  console.log(result.stdout);
} finally {
  await sandbox.delete();
}
```

Private Git repositories can use low-level `proxyConfig` rules when the remote
requires proxy-managed auth. There is not yet a high-level private Git auth
helper.

## Frequently Asked Questions

## Semantic versioning

This package generally follows [SemVer](https://semver.org/spec/v2.0.0.html) conventions, though certain backwards-incompatible changes may be released as minor versions:

1. Changes that only affect static types, without breaking runtime behavior.
2. Changes to library internals which are technically public but not intended or documented for external use. _(Please open a GitHub issue to let us know if you are relying on such internals.)_
3. Changes that we do not expect to impact the vast majority of users in practice.

We take backwards-compatibility seriously and work hard to ensure you can rely on a smooth upgrade experience.

We are keen for your feedback; please open an [issue](https://www.github.com/langchain-ai/langsmith-javascript/issues) with questions, bugs, or suggestions.

## Requirements

TypeScript >= 4.9 is supported.

The following runtimes are supported:

- Web browsers (Up-to-date Chrome, Firefox, Safari, Edge, and more)
- Node.js 20 LTS or later ([non-EOL](https://endoflife.date/nodejs)) versions.
- Deno v1.28.0 or higher.
- Bun 1.0 or later.
- Cloudflare Workers.
- Vercel Edge Runtime.
- Jest 28 or greater with the `"node"` environment (`"jsdom"` is not supported at this time).
- Nitro v2.6 or greater.

Note that React Native is not supported at this time.

If you are interested in other runtime environments, please open or upvote an issue on GitHub.

## Contributing

See [the contributing documentation](./CONTRIBUTING.md).
