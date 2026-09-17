import { createContext, useContext, type ReactNode } from 'react'
import type { WorkspacePlanDetails } from '@openstaff/shared'

const PlanContext = createContext<WorkspacePlanDetails | null>(null)

export function PlanProvider({ value, children }: { value: WorkspacePlanDetails; children: ReactNode }) {
  return <PlanContext value={value}>{children}</PlanContext>
}

export function usePlan(): WorkspacePlanDetails {
  const plan = useContext(PlanContext)
  if (!plan) throw new Error('Plan context is unavailable')
  return plan
}
