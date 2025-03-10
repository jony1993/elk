<script setup lang="ts">
import type { mastodon } from 'masto'

const props = withDefaults(
  defineProps<{
    status: mastodon.v1.Status
    actions?: boolean
    context?: mastodon.v2.FilterContext
    hover?: boolean
    faded?: boolean

    // If we know the prev and next status in the timeline, we can simplify the card
    older?: mastodon.v1.Status
    newer?: mastodon.v1.Status
    // Manual overrides
    hasOlder?: boolean
    hasNewer?: boolean

    // When looking into a detailed view of a post, we can simplify the replying badges
    // to the main expanded post
    main?: mastodon.v1.Status
  }>(),
  { actions: true },
)

const status = $computed(() => {
  if (props.status.reblog && !props.status.content)
    return props.status.reblog
  return props.status
})

// Use original status, avoid connecting a reblog
const directReply = $computed(() => props.hasNewer || (!!status.inReplyToId && (status.inReplyToId === props.newer?.id || status.inReplyToId === props.newer?.reblog?.id)))
// Use reblogged status, connect it to further replies
const connectReply = $computed(() => props.hasOlder || status.id === props.older?.inReplyToId || status.id === props.older?.reblog?.inReplyToId)
// Open a detailed status, the replies directly to it
const replyToMain = $computed(() => props.main && props.main.id === status.inReplyToId)

const rebloggedBy = $computed(() => props.status.reblog ? props.status.account : null)

const statusRoute = $computed(() => getStatusRoute(status))

const el = ref<HTMLElement>()
const router = useRouter()

function onclick(evt: MouseEvent | KeyboardEvent) {
  const path = evt.composedPath() as HTMLElement[]
  const el = path.find(el => ['A', 'BUTTON', 'IMG', 'VIDEO'].includes(el.tagName?.toUpperCase()))
  const text = window.getSelection()?.toString()
  if (!el && !text)
    go(evt)
}

function go(evt: MouseEvent | KeyboardEvent) {
  if (evt.metaKey || evt.ctrlKey) {
    window.open(statusRoute.href)
  }
  else {
    cacheStatus(status)
    router.push(statusRoute)
  }
}

const createdAt = useFormattedDateTime(status.createdAt)
const timeAgoOptions = useTimeAgoOptions(true)
const timeago = useTimeAgo(() => status.createdAt, timeAgoOptions)

// Content Filter logic
const filterResult = $computed(() => status.filtered?.length ? status.filtered[0] : null)
const filter = $computed(() => filterResult?.filter)

const filterPhrase = $computed(() => filter?.title)
const isFiltered = $computed(() => filterPhrase && (props.context ? filter?.context.includes(props.context) : false))

const isSelfReply = $computed(() => status.inReplyToAccountId === status.account.id)
const collapseRebloggedBy = $computed(() => rebloggedBy?.id === status.account.id)
const isDM = $computed(() => status.visibility === 'direct')

const showUpperBorder = $computed(() => props.newer && !directReply)
const showReplyTo = $computed(() => !replyToMain && !directReply)
</script>

<template>
  <div
    v-if="filter?.filterAction !== 'hide'"
    :id="`status-${status.id}`"
    ref="el"
    relative flex="~ col gap1" p="l-3 r-4 b-2"
    :class="{ 'hover:bg-active': hover }"
    tabindex="0"
    focus:outline-none focus-visible:ring="2 primary"
    :lang="status.language ?? undefined"
    @click="onclick"
    @keydown.enter="onclick"
  >
    <!-- Upper border -->
    <div :h="showUpperBorder ? '1px' : '0'" w-auto bg-border mb-1 />

    <slot name="meta">
      <!-- Line connecting to previous status -->
      <template v-if="status.inReplyToAccountId">
        <StatusReplyingTo
          v-if="showReplyTo"
          ml-6 pt-1 pl-5
          :status="status"
          :is-self-reply="isSelfReply"
          :class="faded ? 'text-secondary-light' : ''"
        />
        <div flex="~ col gap-1" items-center pos="absolute top-0 left-0" w="20.5" z--1>
          <template v-if="showReplyTo">
            <div w="1px" h="0.5" border="x base" mt-3 />
            <div w="1px" h="0.5" border="x base" />
            <div w="1px" h="0.5" border="x base" />
          </template>
          <div w="1px" h-10 border="x base" />
        </div>
      </template>

      <!-- Reblog status -->
      <div flex="~ col" justify-between>
        <div
          v-if="rebloggedBy && !collapseRebloggedBy"
          flex="~" items-center
          p="t-1 b-0.5 x-1px"
          relative text-secondary ws-nowrap
        >
          <div i-ri:repeat-fill me-46px text-green w-16px h-16px />
          <div absolute top-1 ms-24px w-32px h-32px rounded-full>
            <AccountHoverWrapper :account="rebloggedBy">
              <NuxtLink :to="getAccountRoute(rebloggedBy)">
                <AccountAvatar :account="rebloggedBy" />
              </NuxtLink>
            </AccountHoverWrapper>
          </div>
          <AccountInlineInfo font-bold :account="rebloggedBy" :avatar="false" text-sm />
        </div>
      </div>
    </slot>

    <div flex gap-3 :class="{ 'text-secondary': faded }">
      <!-- Avatar -->
      <div relative>
        <div v-if="collapseRebloggedBy" absolute flex items-center justify-center top--6px px-2px py-3px rounded-full bg-base>
          <div i-ri:repeat-fill text-green w-16px h-16px />
        </div>
        <AccountHoverWrapper :account="status.account">
          <NuxtLink :to="getAccountRoute(status.account)" rounded-full>
            <AccountBigAvatar :account="status.account" />
          </NuxtLink>
        </AccountHoverWrapper>

        <div v-if="connectReply" w-full h-full flex mt--3px justify-center>
          <div w-1px border="x base" />
        </div>
      </div>

      <!-- Main -->
      <div flex="~ col 1" min-w-0>
        <!-- Account Info -->
        <div flex items-center space-x-1>
          <AccountHoverWrapper :account="status.account">
            <StatusAccountDetails :account="status.account" />
          </AccountHoverWrapper>
          <div flex-auto />
          <div v-show="!userSettings.zenMode" text-sm text-secondary flex="~ row nowrap" hover:underline>
            <AccountBotIndicator v-if="status.account.bot" me-2 />
            <div flex="~ gap1" items-center>
              <StatusVisibilityIndicator v-if="status.visibility !== 'public'" :status="status" />
              <div flex>
                <CommonTooltip :content="createdAt">
                  <NuxtLink :title="status.createdAt" :href="statusRoute.href" @click.prevent="go($event)">
                    <time text-sm ws-nowrap hover:underline :datetime="status.createdAt">
                      {{ timeago }}
                    </time>
                  </NuxtLink>
                </CommonTooltip>
                <StatusEditIndicator :status="status" inline />
              </div>
            </div>
          </div>
          <StatusActionsMore v-if="actions !== false" :status="status" me--2 />
        </div>

        <!-- Content -->
        <StatusContent :status="status" :context="context" mb2 :class="{ 'mt-2 mb1': isDM }" />
        <StatusActions v-if="actions !== false" v-show="!userSettings.zenMode" :status="status" />
      </div>
    </div>
  </div>
  <div v-else-if="isFiltered" gap-2 p-4 :class="{ 'border-t border-base': newer }">
    <p text-center text-secondary text-sm>
      {{ filterPhrase && `${$t('status.filter_removed_phrase')}: ${filterPhrase}` }}
    </p>
  </div>
</template>
