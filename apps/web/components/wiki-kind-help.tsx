'use client'

import { CircleHelp } from 'lucide-react'
import type { WikiKindDefinition } from '@memon/core'
import { wikiKinds } from '../lib/wiki-kinds'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

export function WikiKindGuide({ kinds = wikiKinds }: { kinds?: readonly WikiKindDefinition[] }) {
  return (
    <div className="space-y-5" data-wiki-kind-guide="">
      {kinds.map((kind) => (
        <section key={kind.id} data-wiki-kind={kind.id} className="space-y-2">
          <h3 className="flex flex-wrap items-baseline gap-2 font-medium">
            {kind.label}
            <code className="text-xs text-muted-foreground">{kind.id}</code>
          </h3>
          <p>{kind.zh.purpose}</p>
          <p>
            <span className="font-medium">适用：</span>
            {kind.zh.uses.join('；')}
          </p>
          <p>
            <span className="font-medium">示例：</span>
            {kind.zh.examples.join('；')}
          </p>
          <p className="text-muted-foreground">{kind.zh.distinctions}</p>
        </section>
      ))}
    </div>
  )
}

export function WikiKindHelp() {
  return (
    <Dialog>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="打开 Wiki 类型指南">
                <CircleHelp className="size-4" aria-hidden="true" />
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>Wiki 类型指南</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DialogContent className="max-h-[85svh] overflow-y-auto break-words sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Wiki 类型指南</DialogTitle>
          <DialogDescription>
            按页面用途选择类型；写作建议不是固定模板。类型变更需显式操作，不会自动移动页面。
          </DialogDescription>
        </DialogHeader>
        <WikiKindGuide />
      </DialogContent>
    </Dialog>
  )
}
