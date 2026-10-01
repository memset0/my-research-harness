// The declarative Backend route table: the concatenation of the resource-domain
// route modules. Every route's path, parameters, query, methods, route class,
// read-only policy, gate, error policy and handler is declared exactly once in
// one of them; the request pipeline derives all routing from this table.

import type { BackendRoute } from '../http/pipeline.js'
import { DOCUMENT_WIKI_ROUTES } from './documents-wiki.js'
import { GIT_ROUTES } from './git.js'
import { PROJECT_SHARE_ROUTES } from './projects-shares.js'
import { RUN_EXPERIMENT_ROUTES } from './runs-experiments.js'
import { STREAM_ASSET_ROUTES } from './stream-assets.js'

export const BACKEND_ROUTES: readonly BackendRoute[] = [
  ...PROJECT_SHARE_ROUTES,
  ...RUN_EXPERIMENT_ROUTES,
  ...DOCUMENT_WIKI_ROUTES,
  ...GIT_ROUTES,
  ...STREAM_ASSET_ROUTES,
]
