<script setup lang="ts">
import { EditorContent } from '@tiptap/vue-3'
import type { mastodon } from 'masto'
import type { Ref } from 'vue'
import type { Draft } from '~/types'

const {
  draftKey,
  initial = getDefaultDraft() as never /* Bug of vue-core */,
  expanded = false,
  placeholder,
  dialogLabelledBy,
} = defineProps<{
  draftKey?: string
  initial?: () => Draft
  placeholder?: string
  inReplyToId?: string
  inReplyToVisibility?: mastodon.v1.StatusVisibility
  expanded?: boolean
  dialogLabelledBy?: string
}>()

const emit = defineEmits<{
  (evt: 'published', status: mastodon.v1.Status): void
}>()

const { t } = useI18n()

const draftState = useDraft(draftKey, initial)
const { draft } = $(draftState)

const {
  isExceedingAttachmentLimit, isUploading, failedAttachments, isOverDropZone,
  uploadAttachments, pickAttachments, setDescription, removeAttachment,
  dropZoneRef,
} = $(useUploadMediaAttachment($$(draft)))

let { shouldExpanded, isExpanded, isSending, isPublishDisabled, publishDraft } = $(usePublish(
  {
    draftState,
    ...$$({ expanded, isUploading, initialDraft: initial }),
  },
))

const { editor } = useTiptap({
  content: computed({
    get: () => draft.params.status,
    set: (newVal) => {
      draft.params.status = newVal
      draft.lastUpdated = Date.now()
    },
  }),
  placeholder: computed(() => placeholder ?? draft.params.inReplyToId ? t('placeholder.replying') : t('placeholder.default_1')),
  autofocus: shouldExpanded,
  onSubmit: publish,
  onFocus() {
    if (!isExpanded && draft.initialText) {
      editor.value?.chain().insertContent(`${draft.initialText} `).focus('end').run()
      draft.initialText = ''
    }
    isExpanded = true
  },
  onPaste: handlePaste,
})
const characterCount = $computed(() => htmlToText(editor.value?.getHTML() || '').length)

async function handlePaste(evt: ClipboardEvent) {
  const files = evt.clipboardData?.files
  if (!files || files.length === 0)
    return

  evt.preventDefault()
  await uploadAttachments(Array.from(files))
}

function insertEmoji(name: string) {
  editor.value?.chain().focus().insertEmoji(name).run()
}
function insertCustomEmoji(image: any) {
  editor.value?.chain().focus().insertCustomEmoji(image).run()
}

async function toggleSensitive() {
  draft.params.sensitive = !draft.params.sensitive
}

async function publish() {
  const status = await publishDraft()
  if (status)
    emit('published', status)
}

defineExpose({
  focusEditor: () => {
    editor.value?.commands?.focus?.()
  },
})
</script>

<template>
  <div v-if="isMastoInitialised && currentUser" flex="~ col gap-4" py3 px2 sm:px4>
    <template v-if="draft.editingStatus">
      <div flex="~ col gap-1">
        <div id="state-editing" text-secondary self-center>
          {{ $t('state.editing') }}
        </div>
        <StatusCard :status="draft.editingStatus" :actions="false" :hover="false" px-0 />
      </div>
      <div border="b dashed gray/40" />
    </template>

    <div flex gap-3 flex-1>
      <NuxtLink :to="getAccountRoute(currentUser.account)">
        <AccountBigAvatar :account="currentUser.account" square />
      </NuxtLink>
      <!-- This `w-0` style is used to avoid overflow problems in flex layouts，so don't remove it unless you know what you're doing -->
      <div
        ref="dropZoneRef"
        flex w-0 flex-col gap-3 flex-1
        border="2 dashed transparent"
        :class="[isSending ? 'pointer-events-none' : '', isOverDropZone ? '!border-primary' : '']"
      >
        <div v-if="draft.params.sensitive">
          <input
            v-model="draft.params.spoilerText"
            type="text"
            :placeholder="$t('placeholder.content_warning')"
            p2 border-rounded w-full bg-transparent
            outline-none border="~ base"
          >
        </div>

        <div relative flex-1 flex flex-col>
          <EditorContent
            :editor="editor"
            flex max-w-full
            :class="shouldExpanded ? 'min-h-30 md:max-h-[calc(100vh-200px)] sm:max-h-[calc(100vh-400px)] max-h-35 of-y-auto overscroll-contain' : ''"
          />
        </div>

        <div v-if="isUploading" flex gap-1 items-center text-sm p1 text-primary>
          <div i-ri:loader-2-fill animate-spin />
          {{ $t('state.uploading') }}
        </div>
        <div
          v-else-if="failedAttachments.length > 0"
          role="alert"
          :aria-describedby="isExceedingAttachmentLimit ? 'upload-failed uploads-per-post' : 'upload-failed'"
          flex="~ col"
          gap-1 text-sm
          pt-1 ps-2 pe-1 pb-2
          text-red-600 dark:text-red-400
          border="~ base rounded red-600 dark:red-400"
        >
          <head id="upload-failed" flex justify-between>
            <div flex items-center gap-x-2 font-bold>
              <div aria-hidden="true" i-ri:error-warning-fill />
              <p>{{ $t('state.upload_failed') }}</p>
            </div>
            <CommonTooltip placement="bottom" :content="$t('action.clear_upload_failed')">
              <button
                flex rounded-4 p1
                hover:bg-active cursor-pointer transition-100
                :aria-label="$t('action.clear_upload_failed')"
                @click="failedAttachments = []"
              >
                <span aria-hidden="true" w="1.75em" h="1.75em" i-ri:close-line />
              </button>
            </CommonTooltip>
          </head>
          <div v-if="isExceedingAttachmentLimit" id="uploads-per-post" ps-2 sm:ps-1 text-small>
            {{ $t('state.attachments_exceed_server_limit') }}
          </div>
          <ol ps-2 sm:ps-1>
            <li v-for="error in failedAttachments" :key="error[0]" flex="~ col sm:row" gap-y-1 sm:gap-x-2>
              <strong>{{ error[1] }}:</strong>
              <span>{{ error[0] }}</span>
            </li>
          </ol>
        </div>

        <div v-if="draft.attachments.length" flex="~ col gap-2" overflow-auto>
          <PublishAttachment
            v-for="(att, idx) in draft.attachments" :key="att.id"
            :attachment="att"
            :dialog-labelled-by="dialogLabelledBy ?? (draft.editingStatus ? 'state-editing' : undefined)"
            @remove="removeAttachment(idx)"
            @set-description="setDescription(att, $event)"
          />
        </div>
      </div>
    </div>
    <div flex gap-4>
      <div w-12 h-full sm:block hidden />
      <div
        v-if="shouldExpanded" flex="~ gap-1 1 wrap" m="s--1" pt-2 justify="between" max-w-full
        border="t base"
      >
        <PublishEmojiPicker
          @select="insertEmoji"
          @select-custom="insertCustomEmoji"
        >
          <button btn-action-icon :title="$t('tooltip.emoji')">
            <div i-ri:emotion-line />
          </button>
        </PublishEmojiPicker>

        <CommonTooltip placement="top" :content="$t('tooltip.add_media')">
          <button btn-action-icon :aria-label="$t('tooltip.add_media')" @click="pickAttachments">
            <div i-ri:image-add-line />
          </button>
        </CommonTooltip>

        <template v-if="editor">
          <CommonTooltip placement="top" :content="$t('tooltip.toggle_code_block')">
            <button
              btn-action-icon
              :aria-label="$t('tooltip.toggle_code_block')"
              :class="editor.isActive('codeBlock') ? 'text-primary' : ''"
              @click="editor?.chain().focus().toggleCodeBlock().run()"
            >
              <div i-ri:code-s-slash-line />
            </button>
          </CommonTooltip>
        </template>

        <div flex-auto />

        <div dir="ltr" pointer-events-none pe-1 pt-2 text-sm tabular-nums text-secondary flex gap="0.5" :class="{ 'text-rose-500': characterCount > characterLimit }">
          {{ characterCount ?? 0 }}<span text-secondary-light>/</span><span text-secondary-light>{{ characterLimit }}</span>
        </div>

        <CommonTooltip placement="top" :content="$t('tooltip.add_content_warning')">
          <button btn-action-icon :aria-label="$t('tooltip.add_content_warning')" @click="toggleSensitive">
            <div v-if="draft.params.sensitive" i-ri:alarm-warning-fill text-orange />
            <div v-else i-ri:alarm-warning-line />
          </button>
        </CommonTooltip>

        <CommonTooltip placement="top" :content="$t('tooltip.change_language')">
          <CommonDropdown placement="bottom" auto-boundary-max-size>
            <button btn-action-icon :aria-label="$t('tooltip.change_language')" w-12 mr--1>
              <div i-ri:translate-2 />
              <div i-ri:arrow-down-s-line text-sm text-secondary me--1 />
            </button>

            <template #popper>
              <PublishLanguagePicker v-model="draft.params.language" min-w-80 p3 />
            </template>
          </CommonDropdown>
        </CommonTooltip>

        <PublishVisibilityPicker v-model="draft.params.visibility" :editing="!!draft.editingStatus">
          <template #default="{ visibility }">
            <button :disabled="!!draft.editingStatus" :aria-label="$t('tooltip.change_content_visibility')" btn-action-icon :class="{ 'w-12': !draft.editingStatus }">
              <div :class="visibility.icon" />
              <div v-if="!draft.editingStatus" i-ri:arrow-down-s-line text-sm text-secondary me--1 />
            </button>
          </template>
        </PublishVisibilityPicker>

        <CommonTooltip id="publish-tooltip" placement="top" :content="$t('tooltip.add_publishable_content')" :disabled="!isPublishDisabled">
          <button
            btn-solid rounded-3 text-sm w-full flex="~ gap1" items-center
            md:w-fit
            class="publish-button"
            :aria-disabled="isPublishDisabled"
            aria-describedby="publish-tooltip"
            @click="publish"
          >
            <div v-if="isSending" i-ri:loader-2-fill animate-spin />
            <span v-if="draft.editingStatus">{{ $t('action.save_changes') }}</span>
            <span v-else-if="draft.params.inReplyToId">{{ $t('action.reply') }}</span>
            <span v-else>{{ !isSending ? $t('action.publish') : $t('state.publishing') }}</span>
          </button>
        </CommonTooltip>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .publish-button[aria-disabled=true] {
    cursor: not-allowed;
    background-color: var(--c-bg-btn-disabled);
    color: var(--c-text-btn-disabled);
  }
  .publish-button[aria-disabled=true]:hover {
    background-color: var(--c-bg-btn-disabled);
    color: var(--c-text-btn-disabled);
  }
</style>
