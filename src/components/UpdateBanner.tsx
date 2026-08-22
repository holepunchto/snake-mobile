import { Pressable, StyleSheet, Text, View } from 'react-native'
import { theme } from '../theme'
import { canOpenStore, openStore, storeName } from '../store-link'

export type UpdateStatus = '' | 'updating' | 'updated' | 'applying' | 'failed'

type Props = {
  status: UpdateStatus
  minver?: string
  error?: string
  onApply: () => void
}

export function UpdateBanner({ status, minver, error, onApply }: Props) {
  if (minver) {
    return (
      <View style={styles.banner}>
        <View style={styles.row}>
          <Text style={styles.text}>
            {canOpenStore
              ? `Update required (v${minver})`
              : `Update to v${minver} on the ${storeName}`}
          </Text>
          {canOpenStore && (
            <Pressable
              onPress={openStore}
              accessibilityRole='button'
              accessibilityLabel={`Open the ${storeName} listing`}
              style={({ pressed }) => [styles.btn, pressed && styles.btnActive]}
            >
              <Text style={styles.btnText}>Open {storeName}</Text>
            </Pressable>
          )}
        </View>
      </View>
    )
  }

  if (status === '') return null

  return (
    <View style={styles.banner}>
      {status === 'updating' && <Text style={styles.text}>Updating...</Text>}
      {status === 'failed' && <Text style={styles.text}>{error || 'Update failed'}</Text>}
      {(status === 'updated' || status === 'applying') && (
        <View style={styles.row}>
          <Text style={styles.text}>Update ready!</Text>
          <Pressable
            disabled={status === 'applying'}
            onPress={onApply}
            style={({ pressed }) => [
              styles.btn,
              (pressed || status === 'applying') && styles.btnActive
            ]}
          >
            <Text style={styles.btnText}>
              {status === 'applying' ? 'Applying...' : 'Apply update'}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: theme.accent,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center'
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  text: {
    color: theme.background,
    fontFamily: theme.mono,
    fontSize: 14
  },
  btn: {
    borderWidth: 1,
    borderColor: theme.background,
    paddingVertical: 4,
    paddingHorizontal: 10
  },
  btnActive: {
    opacity: 0.6
  },
  btnText: {
    color: theme.background,
    fontFamily: theme.mono,
    fontSize: 14
  }
})
