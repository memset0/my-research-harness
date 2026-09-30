'use client'

/**
 * The only module that pulls in recharts. `render.tsx` loads it lazily so a
 * page with no plot view — or none at all — does not pay for the chart
 * bundle.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '../../../../components/ui/chart'
import type { DatatablePlotView } from './index'
import type { PlotModel, PlotPoint, ScatterModel, ScatterPoint } from './series'

/**
 * Series palette: the theme's `--chart-1` is a near-background grey in this
 * install, so the first series takes the primary colour and the rest walk the
 * darker chart ramp.
 */
const SERIES_COLORS = [
  'var(--primary)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

/**
 * Row key holding the source point. Series names are column values, so the
 * key must be one no cell would ever equal; recharts copies rows with an
 * object spread, which would drop a Symbol.
 */
const POINT_KEY = '\0point'

type PlotRow = Record<string, number | string | PlotPoint | null>

function pointOf(payload: unknown): PlotPoint | null {
  const row = payload as PlotRow | undefined
  const point = row?.[POINT_KEY]
  return point !== null && typeof point === 'object' ? point : null
}

export function DatatablePlot({ view, model }: { view: DatatablePlotView; model: PlotModel }) {
  // Series names come from the data, so they are not usable as CSS custom
  // property names; the colour goes straight onto each mark instead of
  // through `--color-<key>`.
  const colors = model.series.map((_name, index) => SERIES_COLORS[index % SERIES_COLORS.length]!)
  const config: ChartConfig = {}
  model.series.forEach((name, index) => {
    config[name] = { label: name, color: colors[index] }
  })
  // A line over numeric x is drawn to scale; bars stay one slot per x.
  const numericAxis = view.type === 'line' && model.numericX
  const rows: PlotRow[] = model.points.map((point) => ({
    x: numericAxis ? point.xNumber : point.x,
    ...point.values,
    [POINT_KEY]: point,
  }))
  const yDomain: [number | 'auto', 'auto'] = [view.y_from_zero ? 0 : 'auto', 'auto']
  const xAxis = numericAxis ? (
    <XAxis
      dataKey="x"
      type="number"
      domain={[view.x_from_zero ? 0 : 'dataMin', 'dataMax']}
      tickLine={false}
      axisLine={false}
      tickMargin={8}
    />
  ) : (
    <XAxis dataKey="x" tickLine={false} axisLine={false} tickMargin={8} />
  )
  const tooltip = (
    <ChartTooltip
      content={
        <ChartTooltipContent
          labelFormatter={(_label, payload) => pointOf(payload?.[0]?.payload)?.x ?? ''}
          formatter={(value, name, item) => {
            const point = pointOf(item.payload)
            const key = String(name)
            const raw = point?.labels[key] ?? String(value)
            return (
              <div className="flex w-full items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color as string | undefined }}
                  aria-hidden
                />
                <span className="text-muted-foreground">{key}</span>
                <span
                  className="ml-auto font-mono font-medium tabular-nums text-foreground"
                  data-datatable-raw=""
                >
                  {raw}
                </span>
              </div>
            )
          }}
        />
      }
    />
  )

  return (
    <ChartContainer config={config} className="min-h-[220px] w-full">
      {view.type === 'line' ? (
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} />
          {xAxis}
          <YAxis domain={yDomain} tickLine={false} axisLine={false} tickMargin={8} width={60} />
          {tooltip}
          {model.series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
          {model.series.map((name, index) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={colors[index]}
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: colors[index] }}
              activeDot={{ r: 5, strokeWidth: 0, fill: colors[index] }}
              connectNulls
            />
          ))}
        </LineChart>
      ) : (
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} />
          {xAxis}
          <YAxis domain={yDomain} tickLine={false} axisLine={false} tickMargin={8} width={60} />
          {tooltip}
          {model.series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
          {model.series.map((name, index) => (
            <Bar key={name} dataKey={name} fill={colors[index]} radius={2} />
          ))}
        </BarChart>
      )}
    </ChartContainer>
  )
}

function seriesConfig(series: readonly string[]) {
  const colors = series.map((_name, index) => SERIES_COLORS[index % SERIES_COLORS.length]!)
  const config: ChartConfig = {}
  series.forEach((name, index) => {
    config[name] = { label: name, color: colors[index] }
  })
  return { colors, config }
}

/**
 * One dot per row on two numeric axes. The tooltip prints the hovered row's
 * declared `x` and `y` cells, not recharts' formatted numbers.
 */
export function DatatableScatter({
  view,
  model,
}: {
  view: DatatablePlotView
  model: ScatterModel
}) {
  const { colors, config } = seriesConfig(model.series)
  const bySeries = model.series.map((name) => model.points.filter((point) => point.series === name))
  const tooltip = (
    <ChartTooltip
      cursor={{ strokeDasharray: '3 3' }}
      content={({ active, payload }) => {
        const point = payload?.[0]?.payload as ScatterPoint | undefined
        if (!active || !point) return null
        const color = colors[model.series.indexOf(point.series)]
        return (
          <div className="grid min-w-32 gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
            {model.series.length > 1 && (
              <div className="flex items-center gap-2 font-medium">
                <span
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                {point.series}
              </div>
            )}
            {[
              [view.x, point.xLabel],
              [view.y, point.yLabel],
            ].map(([name, raw]) => (
              <div key={name} className="flex w-full items-center gap-2">
                <span className="text-muted-foreground">{name}</span>
                <span
                  className="ml-auto font-mono font-medium tabular-nums text-foreground"
                  data-datatable-raw=""
                >
                  {raw}
                </span>
              </div>
            ))}
          </div>
        )
      }}
    />
  )

  return (
    <ChartContainer config={config} className="min-h-[220px] w-full">
      <ScatterChart margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid />
        <XAxis
          dataKey="x"
          type="number"
          name={view.x}
          domain={[view.x_from_zero ? 0 : 'auto', 'auto']}
          // Keeps dots on the extreme values whole instead of cut by the plot edge.
          padding={{ left: 12, right: 12 }}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          dataKey="y"
          type="number"
          name={view.y}
          domain={[view.y_from_zero ? 0 : 'auto', 'auto']}
          padding={{ top: 12, bottom: 12 }}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={60}
        />
        {tooltip}
        {/* Legend in series first-appearance order, not recharts' default name sort. */}
        {model.series.length > 1 && (
          <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
        )}
        {model.series.map((name, index) => (
          <Scatter
            key={name}
            name={name}
            data={bySeries[index]}
            fill={colors[index]}
            isAnimationActive={false}
          />
        ))}
      </ScatterChart>
    </ChartContainer>
  )
}
