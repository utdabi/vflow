// components/CapacityBar.tsx
// Horizontal fill bar showing volunteer assignment capacity for a shift.
import { View, Text } from 'react-native'

interface Props {
  assigned: number
  min: number
  max: number
}

export default function CapacityBar({ assigned, min, max }: Props) {
  const pct = max > 0 ? Math.min(assigned / max, 1) : 0

  let barColor: string
  let statusText: string
  if (assigned === 0) {
    barColor = '#d1d5db'  // gray-300
    statusText = `0 / ${max} volunteers assigned`
  } else if (assigned >= max) {
    barColor = '#22c55e'  // green-500
    statusText = `${assigned} / ${max} — Full`
  } else if (assigned >= min) {
    barColor = '#facc15'  // yellow-400
    statusText = `${assigned} / ${max} — Partially filled`
  } else {
    barColor = '#ef4444'  // red-500
    statusText = `${assigned} / ${max} — Below minimum (need ${min})`
  }

  return (
    <View>
      <View
        className="h-2.5 rounded-full overflow-hidden"
        style={{ backgroundColor: '#f3f4f6' }}
      >
        <View
          className="h-full rounded-full"
          style={{ width: `${pct * 100}%`, backgroundColor: barColor }}
        />
      </View>
      <Text className="text-xs text-gray-500 text-center mt-1">{statusText}</Text>
    </View>
  )
}
