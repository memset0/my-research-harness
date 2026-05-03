// Compatibility re-export shim.
//
// Existing components import `{ Button, Card, ..., StatusPill }` from `'./ui'`.
// We now back those by shadcn primitives in `./ui/*` and our own
// `./status-pill`. Import paths stay stable.

export { Button, buttonVariants } from './ui/button'
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from './ui/card'
export { Badge, badgeVariants } from './ui/badge'
export { StatusPill } from './status-pill'
