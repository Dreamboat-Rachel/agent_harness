// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import * as ThreadsAPI from './threads';
import { ThreadActivateSandboxResponse, Threads } from './threads';

export class Fleet extends APIResource {
  threads: ThreadsAPI.Threads = new ThreadsAPI.Threads(this._client);
}

Fleet.Threads = Threads;

export declare namespace Fleet {
  export { Threads as Threads, type ThreadActivateSandboxResponse as ThreadActivateSandboxResponse };
}
