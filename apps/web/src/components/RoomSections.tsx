import { cloneElement, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Folder, Plus, Search, X } from 'lucide-react'
import type { RoomView } from '../lib/loaders'
import { api } from '../lib/api'
import { mergeSectionNames, normalizeSectionName, renameSectionInRegistry, ROOM_SECTION_MAX_LENGTH } from '../lib/room-sections'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

interface RoomsCache { rooms: RoomView[] }
interface SectionsCache { sections: Array<{ name: string }> }
interface RoomDataCache { room: RoomView; rooms: RoomView[] }

export const roomsQueryKey = (userId: string) => ['rooms', userId] as const
export const roomSectionsQueryKey = (userId: string) => ['room-sections', userId] as const

function patchSection(room: RoomView, section: string | null): RoomView {
  return room.section === section ? room : { ...room, section }
}

export function patchRoomSectionCaches(queryClient: QueryClient, userId: string, roomId: string, section: string | null) {
  queryClient.setQueryData<RoomsCache>(roomsQueryKey(userId), (current) => current && ({
    ...current,
    rooms: current.rooms.map((room) => room.id === roomId ? patchSection(room, section) : room),
  }))
  queryClient.setQueriesData<RoomDataCache>({ queryKey: ['room-data'] }, (current) => current && ({
    ...current,
    room: current.room.id === roomId ? patchSection(current.room, section) : current.room,
    rooms: current.rooms.map((room) => room.id === roomId ? patchSection(room, section) : room),
  }))
}

export function patchSharedRoomFields(queryClient: QueryClient, userId: string, roomId: string, updated: Partial<RoomView>) {
  queryClient.setQueryData<RoomsCache>(roomsQueryKey(userId), (current) => current && ({
    ...current,
    rooms: current.rooms.map((room) => room.id === roomId ? { ...room, ...updated } : room),
  }))
  if (Object.hasOwn(updated, 'section')) {
    const section = normalizeSectionName(updated.section)
    if (section) queryClient.setQueryData<SectionsCache>(roomSectionsQueryKey(userId), (current) => current && ({
      sections: current.sections.some((item) => item.name.toLowerCase() === section.toLowerCase())
        ? current.sections
        : [...current.sections, { name: section }],
    }))
    void queryClient.invalidateQueries({ queryKey: roomSectionsQueryKey(userId) })
  }
}

export function patchSharedRoom(queryClient: QueryClient, userId: string, updated: RoomView) {
  patchSharedRoomFields(queryClient, userId, updated.id, updated)
}

interface Feedback {
  id: number
  kind: 'success' | 'error'
  message: string
  actionLabel?: 'Undo' | 'Retry'
  action?: () => void
}

interface RoomSectionsValue {
  rooms: RoomView[]
  sectionNames: string[]
  organizationBusy: boolean
  assignRoom: (roomId: string, section: string | null) => Promise<boolean>
  createSection: (name: string, feedback?: boolean) => Promise<string>
  createAndAssign: (roomId: string, name: string) => Promise<boolean>
  renameSection: (name: string, newName: string) => Promise<string>
  registerRoom: (room: RoomView) => Promise<void>
}

const RoomSectionsContext = createContext<RoomSectionsValue | null>(null)

export function useRoomSections() {
  const value = useContext(RoomSectionsContext)
  if (!value) throw new Error('useRoomSections must be used inside AppShell')
  return value
}

export function RoomSectionsProvider({ userId, initialRooms, children }: { userId: string; initialRooms: RoomView[]; children: ReactNode }) {
  const queryClient = useQueryClient()
  const roomsKey = roomsQueryKey(userId)
  const sectionsKey = roomSectionsQueryKey(userId)
  const roomsQuery = useQuery({
    queryKey: roomsKey,
    queryFn: () => api<RoomsCache>('/api/rooms'),
    initialData: () => queryClient.getQueryData<RoomsCache>(roomsKey) ?? { rooms: initialRooms },
    initialDataUpdatedAt: () => queryClient.getQueryState(roomsKey)?.dataUpdatedAt ?? 0,
    refetchOnMount: 'always',
  })
  const sectionsQuery = useQuery({
    queryKey: sectionsKey,
    queryFn: () => api<SectionsCache>('/api/rooms/sections'),
    staleTime: 5_000,
  })
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [feedbackPaused, setFeedbackPaused] = useState(false)
  const [feedbackClosing, setFeedbackClosing] = useState(false)
  const [organizationBusy, setOrganizationBusy] = useState(false)
  const organizationBusyRef = useRef(false)
  const operationByRoom = useRef(new Map<string, symbol>())
  const sectionMutationQueue = useRef<Promise<void>>(Promise.resolve())
  const assignRef = useRef<(roomId: string, section: string | null, expected?: string | null, showSuccess?: boolean) => Promise<boolean>>(async () => false)
  const createAndAssignRef = useRef<(roomId: string, name: string) => Promise<boolean>>(async () => false)
  const feedbackCloseTimer = useRef<number | null>(null)

  const dismissFeedback = useCallback(() => {
    setFeedbackClosing(true)
    if (feedbackCloseTimer.current) window.clearTimeout(feedbackCloseTimer.current)
    feedbackCloseTimer.current = window.setTimeout(() => { setFeedback(null); setFeedbackClosing(false) }, 120)
  }, [])

  useEffect(() => {
    if (!feedback || feedback.kind === 'error' || feedbackPaused) return
    const timer = window.setTimeout(dismissFeedback, 5_000)
    return () => window.clearTimeout(timer)
  }, [dismissFeedback, feedback, feedbackPaused])

  useEffect(() => () => { if (feedbackCloseTimer.current) window.clearTimeout(feedbackCloseTimer.current) }, [])

  useEffect(() => {
    queryClient.setQueryData<RoomsCache>(roomsKey, (current) => {
      if (!current) return { rooms: initialRooms }
      return {
        rooms: initialRooms.map((incoming) => {
          const cached = current.rooms.find((room) => room.id === incoming.id)
          return cached ? { ...incoming, section: cached.section } : incoming
        }),
      }
    })
  }, [initialRooms, queryClient, userId])

  const notify = useCallback((next: Omit<Feedback, 'id'>) => {
    if (feedbackCloseTimer.current) window.clearTimeout(feedbackCloseTimer.current)
    setFeedbackClosing(false)
    setFeedback({ ...next, id: Date.now() })
  }, [])
  const addSectionToCache = useCallback((name: string) => {
    queryClient.setQueryData<SectionsCache>(sectionsKey, (current) => {
      const sections = current?.sections ?? []
      return sections.some((item) => item.name.toLowerCase() === name.toLowerCase()) ? { sections } : { sections: [...sections, { name }] }
    })
  }, [queryClient, userId])

  const createSection = useCallback(async (rawName: string, showFeedback = true, retryAction?: () => void): Promise<string> => {
    const name = normalizeSectionName(rawName)
    if (!name || name.length > ROOM_SECTION_MAX_LENGTH) throw new Error(`Section names must be 1 to ${ROOM_SECTION_MAX_LENGTH} characters`)
    try {
      const result = await api<{ section: { name: string } }>('/api/rooms/sections', { method: 'POST', body: JSON.stringify({ name }) })
      addSectionToCache(result.section.name)
      if (showFeedback) notify({ kind: 'success', message: `Created ${result.section.name}` })
      return result.section.name
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not create section'
      notify({ kind: 'error', message, actionLabel: 'Retry', action: retryAction ?? (() => { void createSection(name, showFeedback).catch(() => undefined) }) })
      throw reason
    }
  }, [addSectionToCache, notify])

  const performAssignmentNow = useCallback(async (roomId: string, rawSection: string | null, expectedOverride?: string | null, showSuccess = true): Promise<boolean> => {
    const desired = normalizeSectionName(rawSection)
    const currentRoom = queryClient.getQueryData<RoomsCache>(roomsKey)?.rooms.find((room) => room.id === roomId)
    if (!currentRoom) return false
    const previousRaw = currentRoom.section ?? null
    const previous = normalizeSectionName(previousRaw)
    const expectedRaw = expectedOverride === undefined ? previousRaw : expectedOverride
    if (expectedOverride !== undefined && previousRaw !== expectedRaw) {
      try {
        const fresh = await api<{ room: RoomView }>(`/api/rooms/${roomId}`)
        patchRoomSectionCaches(queryClient, userId, roomId, fresh.room.section ?? null)
      } catch { /* the shared rooms query below will reconcile when connectivity returns */ }
      notify({ kind: 'error', message: 'This room changed before Undo could be applied.' })
      void queryClient.invalidateQueries({ queryKey: roomsKey })
      return false
    }
    if (previous === desired) return true

    const operation = Symbol(roomId)
    operationByRoom.current.set(roomId, operation)
    await Promise.all([
      queryClient.cancelQueries({ queryKey: roomsKey }),
      queryClient.cancelQueries({ queryKey: ['room-data'] }),
    ])
    patchRoomSectionCaches(queryClient, userId, roomId, desired)
    if (desired) addSectionToCache(desired)
    try {
      const result = await api<{ room: RoomView }>(`/api/rooms/${roomId}`, {
        method: 'PATCH',
        body: JSON.stringify({ section: desired, expectedSection: expectedRaw }),
      })
      if (operationByRoom.current.get(roomId) !== operation) return true
      operationByRoom.current.delete(roomId)
      const saved = normalizeSectionName(result.room.section)
      patchRoomSectionCaches(queryClient, userId, roomId, saved)
      if (saved) addSectionToCache(saved)
      if (showSuccess) notify({
        kind: 'success',
        message: saved ? `Moved to ${saved}` : 'Moved to Rooms',
        actionLabel: 'Undo',
        action: () => { void assignRef.current(roomId, previousRaw, saved, false) },
      })
      void queryClient.invalidateQueries({ queryKey: roomsKey })
      void queryClient.invalidateQueries({ queryKey: ['room-data'], refetchType: 'none' })
      return true
    } catch (reason) {
      if (operationByRoom.current.get(roomId) !== operation) return false
      operationByRoom.current.delete(roomId)
      let restored = previousRaw
      if (reason instanceof Error && reason.message === 'Room section changed') {
        try {
          const fresh = await api<{ room: RoomView }>(`/api/rooms/${roomId}`)
          restored = fresh.room.section ?? null
        } catch { /* retain the section from before this scoped operation */ }
      }
      const latest = queryClient.getQueryData<RoomsCache>(roomsKey)?.rooms.find((room) => room.id === roomId)
      if (normalizeSectionName(latest?.section) === desired) patchRoomSectionCaches(queryClient, userId, roomId, restored)
      const message = reason instanceof Error ? reason.message : 'Could not move room'
      const undoFailure = expectedOverride !== undefined
      notify(undoFailure
        ? { kind: 'error', message: message === 'Room section changed' ? 'This room changed before Undo could be applied.' : message }
        : { kind: 'error', message, actionLabel: 'Retry', action: () => { void assignRef.current(roomId, desired) } })
      void queryClient.invalidateQueries({ queryKey: roomsKey })
      void queryClient.invalidateQueries({ queryKey: ['room-data'], refetchType: 'none' })
      return false
    }
  }, [addSectionToCache, notify, queryClient, userId])
  const performAssignment = useCallback((roomId: string, section: string | null, expected?: string | null, showSuccess = true): Promise<boolean> => {
    const previous = sectionMutationQueue.current
    const result = previous.then(() => performAssignmentNow(roomId, section, expected, showSuccess))
    const settled = result.then(() => undefined, () => undefined)
    sectionMutationQueue.current = settled
    return result
  }, [performAssignmentNow])
  assignRef.current = performAssignment

  const assignRoom = useCallback((roomId: string, section: string | null) => organizationBusyRef.current ? Promise.resolve(false) : performAssignment(roomId, section), [performAssignment])
  const createAndAssign = useCallback((roomId: string, name: string): Promise<boolean> => {
    if (organizationBusyRef.current) return Promise.resolve(false)
    const previous = sectionMutationQueue.current
    const result = previous.then(async () => {
      try {
        const canonical = await createSection(name, false, () => { void createAndAssignRef.current(roomId, name) })
        return await performAssignmentNow(roomId, canonical)
      } catch {
        return false
      }
    })
    sectionMutationQueue.current = result.then(() => undefined, () => undefined)
    return result
  }, [createSection, performAssignmentNow])
  createAndAssignRef.current = createAndAssign

  const performRenameNow = useCallback(async (rawName: string, rawNewName: string): Promise<string> => {
    const name = normalizeSectionName(rawName)
    const newName = normalizeSectionName(rawNewName)
    if (!name || !newName || newName.length > ROOM_SECTION_MAX_LENGTH) throw new Error(`Section names must be 1 to ${ROOM_SECTION_MAX_LENGTH} characters`)
    await Promise.all([
      queryClient.cancelQueries({ queryKey: roomsKey }),
      queryClient.cancelQueries({ queryKey: ['room-data'] }),
      queryClient.cancelQueries({ queryKey: sectionsKey }),
    ])
    const result = await api<{ section: { name: string }; previousName: string; rooms: Array<{ id: string; section: string | null }> }>('/api/rooms/sections', {
      method: 'PATCH',
      body: JSON.stringify({ name, newName }),
    })
    for (const room of result.rooms) patchRoomSectionCaches(queryClient, userId, room.id, room.section)
    queryClient.setQueryData<SectionsCache>(sectionsKey, (current) => ({
      sections: renameSectionInRegistry(current?.sections.map((section) => section.name) ?? [], result.previousName, result.section.name).map((sectionName) => ({ name: sectionName })),
    }))
    setFeedback(null)
    setFeedbackClosing(false)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sectionsKey }),
      queryClient.invalidateQueries({ queryKey: roomsKey }),
      queryClient.invalidateQueries({ queryKey: ['room-data'], refetchType: 'none' }),
    ])
    return result.section.name
  }, [queryClient, userId])
  const renameSection = useCallback((name: string, newName: string): Promise<string> => {
    if (organizationBusyRef.current) return Promise.reject(new Error('Another section rename is already in progress'))
    organizationBusyRef.current = true
    setOrganizationBusy(true)
    setFeedback(null)
    setFeedbackClosing(false)
    const previous = sectionMutationQueue.current
    const result = previous.then(() => performRenameNow(name, newName))
    const settled = result.then(() => undefined, () => undefined)
    sectionMutationQueue.current = settled
    void settled.finally(() => {
      organizationBusyRef.current = false
      setOrganizationBusy(false)
    })
    return result
  }, [performRenameNow])

  const registerRoom = useCallback(async (room: RoomView) => {
    queryClient.setQueryData<RoomsCache>(roomsKey, (current) => ({ rooms: current?.rooms.some((item) => item.id === room.id) ? current.rooms : [...(current?.rooms ?? []), room] }))
    queryClient.setQueriesData<RoomDataCache>({ queryKey: ['room-data'] }, (current) => current && ({ ...current, rooms: current.rooms.some((item) => item.id === room.id) ? current.rooms : [...current.rooms, room] }))
    const section = normalizeSectionName(room.section)
    if (section) addSectionToCache(section)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: roomsKey }),
      section ? queryClient.invalidateQueries({ queryKey: sectionsKey }) : Promise.resolve(),
    ])
  }, [addSectionToCache, queryClient, userId])

  const sectionNames = useMemo(() => mergeSectionNames(sectionsQuery.data?.sections.map((section) => section.name) ?? [], roomsQuery.data.rooms), [roomsQuery.data.rooms, sectionsQuery.data])
  const value = useMemo<RoomSectionsValue>(() => ({ rooms: roomsQuery.data.rooms, sectionNames, organizationBusy, assignRoom, createSection, createAndAssign, renameSection, registerRoom }), [roomsQuery.data.rooms, sectionNames, organizationBusy, assignRoom, createSection, createAndAssign, renameSection, registerRoom])

  return <RoomSectionsContext.Provider value={value}>
    {children}
    {feedback && <div data-testid="section-feedback" data-kind={feedback.kind} data-state={feedbackClosing ? 'closed' : 'open'} role={feedback.kind === 'error' ? 'alert' : 'status'} onMouseEnter={() => setFeedbackPaused(true)} onMouseLeave={() => setFeedbackPaused(false)} onFocusCapture={() => setFeedbackPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFeedbackPaused(false) }} className="room-section-toast">
      <span className="min-w-0 flex-1 truncate">{feedback.message}</span>
      {feedback.action && <button data-testid={feedback.actionLabel === 'Undo' ? 'section-undo' : 'section-retry'} type="button" onClick={() => { const action = feedback.action; dismissFeedback(); action?.() }}>{feedback.actionLabel}</button>}
      <button type="button" aria-label="Dismiss" onClick={dismissFeedback}><X size={14} /></button>
    </div>}
  </RoomSectionsContext.Provider>
}

interface SectionPickerProps {
  roomId: string
  trigger: ReactElement
  align?: 'start' | 'center' | 'end'
  restoreMovedRowFocus?: boolean
}

interface PickerTriggerProps {
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void
}

export function SectionPicker({ roomId, trigger, align = 'start', restoreMovedRowFocus = false }: SectionPickerProps) {
  const { rooms, sectionNames, organizationBusy, assignRoom, createAndAssign } = useRoomSections()
  const room = rooms.find((item) => item.id === roomId)
  const current = normalizeSectionName(room?.section)
  const [open, setOpen] = useState(false)
  const [mobileSheet, setMobileSheet] = useState(false)
  const [openedByPointer, setOpenedByPointer] = useState(true)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const pointerOpen = useRef(false)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)')
    const updateMedia = () => setMobileSheet(media.matches)
    updateMedia()
    media.addEventListener('change', updateMedia)
    return () => media.removeEventListener('change', updateMedia)
  }, [])
  const query = search.trim()
  const matching = sectionNames.filter((name) => name.toLowerCase().includes(query.toLowerCase()))
  const exact = sectionNames.some((name) => name.toLowerCase() === query.toLowerCase())
  const canCreate = Boolean(query) && query.length <= ROOM_SECTION_MAX_LENGTH && !exact
  const triggerElement = trigger as ReactElement<PickerTriggerProps>
  const enhancedTrigger = cloneElement(triggerElement, {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => { pointerOpen.current = true; triggerElement.props.onPointerDown?.(event) },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => { pointerOpen.current = false; triggerElement.props.onKeyDown?.(event) },
  })
  const changeOpen = (next: boolean) => {
    if (next) setOpenedByPointer(pointerOpen.current)
    pointerOpen.current = false
    setOpen(next)
    if (!next) setSearch('')
  }
  const restoreFocus = () => {
    if (!restoreMovedRowFocus) return
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const buttons = document.querySelectorAll<HTMLButtonElement>('[data-testid="sidebar-room-move"]')
      ;[...buttons].find((button) => button.dataset.roomId === roomId)?.focus()
    }))
  }
  const select = (section: string | null) => {
    if (organizationBusy) return
    setOpen(false)
    setSearch('')
    void assignRoom(roomId, section)
    restoreFocus()
  }
  const create = async () => {
    if (!canCreate || busy || organizationBusy) return
    setBusy(true)
    const moved = await createAndAssign(roomId, query)
    setBusy(false)
    if (moved) { setOpen(false); setSearch(''); restoreFocus() }
  }

  const picker = <>
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <strong className="truncate text-[13px] font-semibold">Move to section</strong>
        <button type="button" data-picker-close onClick={() => changeOpen(false)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg" aria-label="Close section picker"><X size={15} /></button>
      </div>
      <label className="mx-3 mb-2 flex h-9 items-center gap-2 rounded-md border border-line-strong bg-surface-3 px-2.5 text-fg-muted focus-within:border-ring">
        <Search size={14} />
        <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && canCreate) { event.preventDefault(); void create() } }} maxLength={ROOM_SECTION_MAX_LENGTH} placeholder="Search or create" aria-label="Search sections" className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-subtle" />
      </label>
      <div className="scrollbar-thin min-h-0 overflow-y-auto border-t border-line p-1.5">
        <button type="button" data-testid="section-option-none" disabled={organizationBusy} onClick={() => select(null)} className="section-picker-option">
          <span className="section-picker-icon"><Folder size={14} /></span><span className="min-w-0 flex-1 truncate">No section</span>{!current && <Check size={15} className="text-accent" />}
        </button>
        {matching.map((name) => <button type="button" key={name.toLowerCase()} data-testid="section-option" data-section-name={name} disabled={organizationBusy} onClick={() => select(name)} className="section-picker-option">
          <span className="section-picker-icon"><Folder size={14} /></span><span className="min-w-0 flex-1 truncate">{name}</span>{current?.toLowerCase() === name.toLowerCase() && <Check size={15} className="text-accent" />}
        </button>)}
        {canCreate && <button type="button" data-testid="section-create-and-assign" disabled={busy || organizationBusy} onClick={() => void create()} className="section-picker-option">
          <span className="section-picker-icon"><Plus size={14} /></span><span className="min-w-0 flex-1 truncate">Create “{query}” and move</span>
        </button>}
        {matching.length === 0 && !canCreate && query && <p className="px-3 py-5 text-center text-xs text-fg-muted">No matching sections</p>}
      </div>
      <p className="section-picker-note border-t border-line px-3 py-2.5 text-[11px] text-fg-subtle">Shared with everyone in this room.</p>
  </>
  const focusSearch = (event: Event) => { event.preventDefault(); requestAnimationFrame(() => searchRef.current?.focus()) }

  if (mobileSheet) return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild>{enhancedTrigger}</DialogTrigger>
    <DialogContent
      label="Move room to section"
      data-testid="section-picker"
      data-instant={openedByPointer ? undefined : 'true'}
      overlayClassName={openedByPointer ? '' : 'section-picker-overlay-instant'}
      onOpenAutoFocus={focusSearch}
      onEscapeKeyDown={() => setOpenedByPointer(false)}
      className="section-picker-dialog !bottom-0 !left-0 !top-auto flex !max-h-[min(78dvh,560px)] !w-full !max-w-none !translate-x-0 !translate-y-0 flex-col !overflow-hidden !rounded-b-none !rounded-t-2xl p-0"
    ><DialogTitle className="sr-only">Move room to section</DialogTitle>{picker}</DialogContent>
  </Dialog>

  return <Popover modal open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>{enhancedTrigger}</PopoverTrigger>
    <PopoverContent
      label="Move room to section"
      data-testid="section-picker"
      data-instant={openedByPointer ? undefined : 'true'}
      align={align}
      collisionPadding={12}
      onOpenAutoFocus={focusSearch}
      onEscapeKeyDown={() => setOpenedByPointer(false)}
      className="section-picker-content flex max-h-[min(480px,calc(100dvh-24px))] w-[302px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0"
    >{picker}</PopoverContent>
  </Popover>
}

export function SectionTriggerLabel({ roomId }: { roomId: string }) {
  const { rooms } = useRoomSections()
  const section = normalizeSectionName(rooms.find((room) => room.id === roomId)?.section)
  return <><Folder size={13} className="shrink-0" /><span className="truncate">{section ?? 'Add to section'}</span><ChevronDown size={13} className="shrink-0" /></>
}
