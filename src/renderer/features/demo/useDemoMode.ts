import { useNavigate } from 'react-router-dom'
import { useAppStatus, useFinMutation } from '@renderer/lib/queries'

/** Switch between demo data and your own; every cached query is reloaded from the newly opened data. */
export function useDemoMode() {
  const navigate = useNavigate()
  const status = useAppStatus()
  const enter = useFinMutation('demo.enter', { reloadAll: true, success: 'Showing demo data', onSuccess: () => navigate('/') })
  const exit = useFinMutation('demo.exit', { reloadAll: true, success: 'Back to your own data', onSuccess: () => navigate('/') })
  return {
    active: status.data?.demo ?? false,
    pending: enter.isPending || exit.isPending,
    enter: () => enter.mutate(undefined),
    exit: () => exit.mutate(undefined),
  }
}
