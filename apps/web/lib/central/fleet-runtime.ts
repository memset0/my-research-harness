import type { EventEmitter } from 'node:events'
import {
  type CentralEvent,
  type Config,
  type HostAvailabilityState,
  isUsableHostAvailabilityState,
} from '@memon/core'
import { getRuntime } from '../runtime'
import { normalizeBackendUpstream } from './backend-client'
import {
  type BackendEventClientError,
  CentralEventFanIn,
  type CentralEventFanInOptions,
} from './backend-events'
import { CentralFleetController } from './fleet-controller'

interface ManagedFleet {
  registry: {
    getAvailability(hostId: string): { state: HostAvailabilityState } | null
    markFailure(
      hostId: string,
      state: 'offline' | 'authentication_failed' | 'misconfigured',
      diagnostic: string,
    ): unknown
  }
  start(): Promise<void>
  stop(): void
}

interface ManagedEventFanIn {
  addHost(upstream: ReturnType<typeof normalizeBackendUpstream>): unknown
  start(): void
  stop(): Promise<void>
}

export interface CentralFleetRuntimeContext {
  config: Config
  events: EventEmitter
}

export interface CentralFleetRuntimeDependencies {
  createFleet?: (config: NonNullable<Config['central']>) => ManagedFleet
  createEventFanIn?: (options: CentralEventFanInOptions) => ManagedEventFanIn
}

export interface CentralFleetRuntimeHandle {
  fleet: ManagedFleet
  fanIn: ManagedEventFanIn
  stop(): Promise<void>
}

let fleetPromise: Promise<CentralFleetRuntimeHandle> | null = null

export async function getCentralFleet(): Promise<CentralFleetController> {
  if (!fleetPromise) fleetPromise = initializeFromRuntime()
  return (await fleetPromise).fleet as CentralFleetController
}

async function initializeFromRuntime(): Promise<CentralFleetRuntimeHandle> {
  return initializeCentralFleetRuntime(await getRuntime())
}

/** Initialize transports and one isolated Backend event client per configured Host. */
export async function initializeCentralFleetRuntime(
  runtime: CentralFleetRuntimeContext,
  dependencies: CentralFleetRuntimeDependencies = {},
): Promise<CentralFleetRuntimeHandle> {
  const central = runtime.config.central
  if (!central) {
    throw new Error('memon: central Host registry is unavailable outside central role')
  }

  const fleet = dependencies.createFleet?.(central) ?? new CentralFleetController(central)
  const fanInOptions: CentralEventFanInOptions = {
    sink: (event: CentralEvent) => {
      const availability = fleet.registry.getAvailability?.(event.host)
      if (!availability || !isUsableHostAvailabilityState(availability.state)) return
      runtime.events.emit('central-event', event)
    },
    onHostFailure: (hostId: string, error: BackendEventClientError) => {
      try {
        fleet.registry.markFailure(hostId, error.state, error.message)
      } catch {
        // A single stale/missing Host cannot take down another Host stream.
      }
    },
  }
  const fanIn = dependencies.createEventFanIn?.(fanInOptions) ?? new CentralEventFanIn(fanInOptions)

  try {
    await fleet.start()
    for (const host of central.hosts) fanIn.addHost(normalizeBackendUpstream(host))
    fanIn.start()
  } catch (error) {
    await fanIn.stop()
    fleet.stop()
    throw error
  }

  let stopped = false
  return {
    fleet,
    fanIn,
    async stop() {
      if (stopped) return
      stopped = true
      await fanIn.stop()
      fleet.stop()
    },
  }
}

export async function stopCentralFleet(): Promise<void> {
  const pending = fleetPromise
  fleetPromise = null
  if (!pending) return
  const runtime = await pending.catch(() => null)
  await runtime?.stop()
}

export function __resetCentralFleetForTests(): void {
  fleetPromise = null
}
