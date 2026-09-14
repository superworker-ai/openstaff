import { expect, it } from 'vitest'
import { desktopInputArguments } from './desktop-input.js'

it('builds desktop input argv with text encoded outside the shell', () => {
  const text = `hello ' " $HOME; $(touch /tmp/nope)\nworld`
  const args = desktopInputArguments({ type: 'type', text })
  expect(args).toEqual(['type-b64', Buffer.from(text).toString('base64')])
  expect(args.join(' ')).not.toContain(text)
  expect(Buffer.from(args[1]!, 'base64').toString()).toBe(text)
})

it('validates key chords and numeric input bounds', () => {
  expect(desktopInputArguments({ type: 'key', key: 'ctrl+l' })).toEqual(['key', 'ctrl+l'])
  expect(desktopInputArguments({ type: 'key', key: 'alt+Tab' })).toEqual(['key', 'alt+Tab'])
  expect(() => desktopInputArguments({ type: 'key', key: 'ctrl+l;whoami' })).toThrow('letters, numbers')
  expect(() => desktopInputArguments({ type: 'move', x: -1, y: 0 })).toThrow('integer from 0 to 10000')
  expect(() => desktopInputArguments({ type: 'scroll', x: 0, y: 0, direction: 'down', amount: 21 })).toThrow('integer from 1 to 20')
})

it('maps clicks, dragging, and scrolling to the POSIX wrapper arguments', () => {
  expect(desktopInputArguments({ type: 'click', x: 12, y: 34, button: 2 })).toEqual(['click', '12', '34', '2'])
  expect(desktopInputArguments({ type: 'double_click', x: 12, y: 34 })).toEqual(['dblclick', '12', '34'])
  expect(desktopInputArguments({ type: 'right_click', x: 12, y: 34 })).toEqual(['click', '12', '34', '3'])
  expect(desktopInputArguments({ type: 'drag', fromX: 1, fromY: 2, toX: 3, toY: 4 })).toEqual(['drag', '1', '2', '3', '4'])
  expect(desktopInputArguments({ type: 'scroll', x: 5, y: 6, direction: 'up', amount: 2 })).toEqual(['scroll', '5', '6', 'up', '2'])
})
