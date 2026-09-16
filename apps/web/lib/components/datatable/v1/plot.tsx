'use client'

/**
 * The only module that pulls in recharts. `render.tsx` loads it lazily so a
 * page with no plot view — or none at all — does not pay for the chart
 * bundle.
 */

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '../../../../components/ui/chart'
import type { DatatablePlotView } from './index'
import type { PlotModel } from './series'

/**
 * Series palette: the theme's `--chart-1` is a near-background grey in this
 * install, so the first series takes the primary colour and the rest walk the
 * darker chart ramp.
 */
const SERIES_COLORS = ['var(--primary)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

export function DatatablePlot({ view, model }: { view: DatatablePlotView; model: PlotModel }) {
  // Series names come from the data, so they are not usable as CSS custom
  // property names; the colour goes straight onto each mark instead of
  // through `--color-<key>`.
  const colors = model.series.map((_name, index) => SERIES_COLORS[index % SERIES_COLORS.length]!)
  const config: ChartConfig = {}
  model.series.forEach((name, index) => {
    config[name] = { label: name, color: colors[index] }
  })
  const rows = model.points.map((point) => ({ x: point.x, ...point.values }))

  return (
    <ChartContainer config={config} className="min-h-[220px] w-full">
      {view.type === 'line' ? (
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="x" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={48} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {model.series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
          {model.series.map((name, index) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={colors[index]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      ) : (
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="x" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={48} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {model.series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
          {model.series.map((name, index) => (
            <Bar key={name} dataKey={name} fill={colors[index]} radius={2} />
          ))}
        </BarChart>
      )}
    </ChartContainer>
  )
}
