/**
 * FAF ADK Layer - Model Definitions
 * 
 * Comprehensive list of all supported models across providers
 * Generated from model_prices.json
 */

export enum Model {
  // ========== OpenAI Models ==========
  
  // GPT-4 Series
  GPT_4 = 'gpt-4',
  GPT_4_1 = 'gpt-4.1',
  GPT_4_1_2025_04_14 = 'gpt-4.1-2025-04-14',
  GPT_4_1_MINI = 'gpt-4.1-mini',
  GPT_4_1_MINI_2025_04_14 = 'gpt-4.1-mini-2025-04-14',
  GPT_4_1_NANO = 'gpt-4.1-nano',
  GPT_4_1_NANO_2025_04_14 = 'gpt-4.1-nano-2025-04-14',
  GPT_4_5_PREVIEW = 'gpt-4.5-preview',
  GPT_4_5_PREVIEW_2025_02_27 = 'gpt-4.5-preview-2025-02-27',
  GPT_4_TURBO = 'gpt-4-turbo',
  GPT_4_TURBO_PREVIEW = 'gpt-4-turbo-preview',
  GPT_4_TURBO_2024_04_09 = 'gpt-4-turbo-2024-04-09',
  GPT_4_1106_PREVIEW = 'gpt-4-1106-preview',
  GPT_4_0125_PREVIEW = 'gpt-4-0125-preview',
  GPT_4_VISION_PREVIEW = 'gpt-4-vision-preview',
  GPT_4_1106_VISION_PREVIEW = 'gpt-4-1106-vision-preview',
  GPT_4_0314 = 'gpt-4-0314',
  GPT_4_0613 = 'gpt-4-0613',
  GPT_4_32K = 'gpt-4-32k',
  GPT_4_32K_0314 = 'gpt-4-32k-0314',
  GPT_4_32K_0613 = 'gpt-4-32k-0613',
  
  // GPT-4o Series
  GPT_4O = 'gpt-4o',
  GPT_4O_2024_05_13 = 'gpt-4o-2024-05-13',
  GPT_4O_2024_08_06 = 'gpt-4o-2024-08-06',
  GPT_4O_2024_11_20 = 'gpt-4o-2024-11-20',
  GPT_4O_SEARCH_PREVIEW = 'gpt-4o-search-preview',
  GPT_4O_SEARCH_PREVIEW_2025_03_11 = 'gpt-4o-search-preview-2025-03-11',
  GPT_4O_AUDIO_PREVIEW = 'gpt-4o-audio-preview',
  GPT_4O_AUDIO_PREVIEW_2024_12_17 = 'gpt-4o-audio-preview-2024-12-17',
  GPT_4O_AUDIO_PREVIEW_2024_10_01 = 'gpt-4o-audio-preview-2024-10-01',
  GPT_4O_AUDIO_PREVIEW_2025_06_03 = 'gpt-4o-audio-preview-2025-06-03',
  GPT_4O_MINI = 'gpt-4o-mini',
  GPT_4O_MINI_2024_07_18 = 'gpt-4o-mini-2024-07-18',
  GPT_4O_MINI_AUDIO_PREVIEW = 'gpt-4o-mini-audio-preview',
  GPT_4O_MINI_AUDIO_PREVIEW_2024_12_17 = 'gpt-4o-mini-audio-preview-2024-12-17',
  GPT_4O_MINI_SEARCH_PREVIEW = 'gpt-4o-mini-search-preview',
  GPT_4O_MINI_SEARCH_PREVIEW_2025_03_11 = 'gpt-4o-mini-search-preview-2025-03-11',
  GPT_4O_REALTIME_PREVIEW = 'gpt-4o-realtime-preview',
  GPT_4O_REALTIME_PREVIEW_2024_10_01 = 'gpt-4o-realtime-preview-2024-10-01',
  GPT_4O_REALTIME_PREVIEW_2024_12_17 = 'gpt-4o-realtime-preview-2024-12-17',
  GPT_4O_REALTIME_PREVIEW_2025_06_03 = 'gpt-4o-realtime-preview-2025-06-03',
  GPT_4O_MINI_REALTIME_PREVIEW = 'gpt-4o-mini-realtime-preview',
  GPT_4O_MINI_REALTIME_PREVIEW_2024_12_17 = 'gpt-4o-mini-realtime-preview-2024-12-17',
  GPT_4O_TRANSCRIBE = 'gpt-4o-transcribe',
  GPT_4O_MINI_TRANSCRIBE = 'gpt-4o-mini-transcribe',
  GPT_4O_MINI_TTS = 'gpt-4o-mini-tts',
  CHATGPT_4O_LATEST = 'chatgpt-4o-latest',
  
  // GPT-3.5 Series
  GPT_3_5_TURBO = 'gpt-3.5-turbo',
  GPT_3_5_TURBO_0301 = 'gpt-3.5-turbo-0301',
  GPT_3_5_TURBO_0613 = 'gpt-3.5-turbo-0613',
  GPT_3_5_TURBO_1106 = 'gpt-3.5-turbo-1106',
  GPT_3_5_TURBO_0125 = 'gpt-3.5-turbo-0125',
  GPT_3_5_TURBO_16K = 'gpt-3.5-turbo-16k',
  GPT_3_5_TURBO_16K_0613 = 'gpt-3.5-turbo-16k-0613',
  GPT_3_5_TURBO_INSTRUCT = 'gpt-3.5-turbo-instruct',
  GPT_3_5_TURBO_INSTRUCT_0914 = 'gpt-3.5-turbo-instruct-0914',
  
  // O1 Series
  O1 = 'o1',
  O1_MINI = 'o1-mini',
  O1_MINI_2024_09_12 = 'o1-mini-2024-09-12',
  O1_PREVIEW = 'o1-preview',
  O1_PREVIEW_2024_09_12 = 'o1-preview-2024-09-12',
  O1_2024_12_17 = 'o1-2024-12-17',
  O1_PRO = 'o1-pro',
  O1_PRO_2025_03_19 = 'o1-pro-2025-03-19',
  
  // O3 Series
  O3 = 'o3',
  O3_2025_04_16 = 'o3-2025-04-16',
  O3_MINI = 'o3-mini',
  O3_MINI_2025_01_31 = 'o3-mini-2025-01-31',
  O3_PRO = 'o3-pro',
  O3_PRO_2025_06_10 = 'o3-pro-2025-06-10',
  O3_DEEP_RESEARCH = 'o3-deep-research',
  O3_DEEP_RESEARCH_2025_06_26 = 'o3-deep-research-2025-06-26',
  
  // O4 Series
  O4_MINI = 'o4-mini',
  O4_MINI_2025_04_16 = 'o4-mini-2025-04-16',
  O4_MINI_DEEP_RESEARCH = 'o4-mini-deep-research',
  O4_MINI_DEEP_RESEARCH_2025_06_26 = 'o4-mini-deep-research-2025-06-26',
  
  // Codex Series
  CODEX_MINI_LATEST = 'codex-mini-latest',
  
  // Legacy Models
  BABBAGE_002 = 'babbage-002',
  DAVINCI_002 = 'davinci-002',
  
  // Fine-tuned Models
  FT_GPT_3_5_TURBO = 'ft:gpt-3.5-turbo',
  FT_GPT_3_5_TURBO_0125 = 'ft:gpt-3.5-turbo-0125',
  FT_GPT_3_5_TURBO_1106 = 'ft:gpt-3.5-turbo-1106',
  FT_GPT_3_5_TURBO_0613 = 'ft:gpt-3.5-turbo-0613',
  FT_GPT_4_0613 = 'ft:gpt-4-0613',
  FT_GPT_4O_2024_08_06 = 'ft:gpt-4o-2024-08-06',
  FT_GPT_4O_2024_11_20 = 'ft:gpt-4o-2024-11-20',
  FT_GPT_4O_MINI_2024_07_18 = 'ft:gpt-4o-mini-2024-07-18',
  FT_DAVINCI_002 = 'ft:davinci-002',
  FT_BABBAGE_002 = 'ft:babbage-002',
  
  // Embedding Models
  TEXT_EMBEDDING_3_LARGE = 'text-embedding-3-large',
  TEXT_EMBEDDING_3_SMALL = 'text-embedding-3-small',
  TEXT_EMBEDDING_ADA_002 = 'text-embedding-ada-002',
  TEXT_EMBEDDING_ADA_002_V2 = 'text-embedding-ada-002-v2',
  
  // Moderation Models
  OMNI_MODERATION_LATEST = 'omni-moderation-latest',
  OMNI_MODERATION_LATEST_INTENTS = 'omni-moderation-latest-intents',
  OMNI_MODERATION_2024_09_26 = 'omni-moderation-2024-09-26',
  TEXT_MODERATION_STABLE = 'text-moderation-stable',
  TEXT_MODERATION_007 = 'text-moderation-007',
  TEXT_MODERATION_LATEST = 'text-moderation-latest',
  
  // Audio Models
  WHISPER_1 = 'whisper-1',
  TTS_1 = 'tts-1',
  TTS_1_HD = 'tts-1-hd',
  
  // Image Models
  GPT_IMAGE_1 = 'gpt-image-1',
  DALL_E_2 = 'dall-e-2',
  DALL_E_3 = 'dall-e-3',
  
  // ========== Anthropic Models ==========
  
  CLAUDE_3_HAIKU_20240307 = 'claude-3-haiku-20240307',
  CLAUDE_3_5_HAIKU_20241022 = 'claude-3-5-haiku-20241022',
  CLAUDE_3_5_HAIKU_LATEST = 'claude-3-5-haiku-latest',
  CLAUDE_3_OPUS_20240229 = 'claude-3-opus-20240229',
  CLAUDE_3_OPUS_LATEST = 'claude-3-opus-latest',
  CLAUDE_3_5_SONNET_20240620 = 'claude-3-5-sonnet-20240620',
  CLAUDE_3_5_SONNET_20241022 = 'claude-3-5-sonnet-20241022',
  CLAUDE_3_5_SONNET_LATEST = 'claude-3-5-sonnet-latest',
  CLAUDE_3_7_SONNET_LATEST = 'claude-3-7-sonnet-latest',
  CLAUDE_3_7_SONNET_20250219 = 'claude-3-7-sonnet-20250219',
  CLAUDE_OPUS_4_20250514 = 'claude-opus-4-20250514',
  CLAUDE_OPUS_4_1_20250805 = 'claude-opus-4-1-20250805',
  CLAUDE_SONNET_4_20250514 = 'claude-sonnet-4-20250514',
  CLAUDE_4_OPUS_20250514 = 'claude-4-opus-20250514',
  CLAUDE_4_SONNET_20250514 = 'claude-4-sonnet-20250514',
  
  // ========== Google Gemini Models ==========
  
  // Gemini 1.0 Series
  GEMINI_PRO = 'gemini-pro',
  GEMINI_1_0_PRO = 'gemini-1.0-pro',
  GEMINI_1_0_PRO_001 = 'gemini-1.0-pro-001',
  GEMINI_1_0_PRO_002 = 'gemini-1.0-pro-002',
  GEMINI_1_0_ULTRA = 'gemini-1.0-ultra',
  GEMINI_1_0_ULTRA_001 = 'gemini-1.0-ultra-001',
  GEMINI_PRO_VISION = 'gemini-pro-vision',
  GEMINI_1_0_PRO_VISION = 'gemini-1.0-pro-vision',
  GEMINI_1_0_PRO_VISION_001 = 'gemini-1.0-pro-vision-001',
  
  // Gemini 1.5 Series
  GEMINI_1_5_PRO = 'gemini-1.5-pro',
  GEMINI_1_5_PRO_001 = 'gemini-1.5-pro-001',
  GEMINI_1_5_PRO_002 = 'gemini-1.5-pro-002',
  GEMINI_1_5_PRO_PREVIEW_0514 = 'gemini-1.5-pro-preview-0514',
  GEMINI_1_5_PRO_PREVIEW_0215 = 'gemini-1.5-pro-preview-0215',
  GEMINI_1_5_PRO_PREVIEW_0409 = 'gemini-1.5-pro-preview-0409',
  GEMINI_1_5_FLASH = 'gemini-1.5-flash',
  GEMINI_1_5_FLASH_001 = 'gemini-1.5-flash-001',
  GEMINI_1_5_FLASH_002 = 'gemini-1.5-flash-002',
  GEMINI_1_5_FLASH_PREVIEW_0514 = 'gemini-1.5-flash-preview-0514',
  GEMINI_1_5_FLASH_EXP_0827 = 'gemini-1.5-flash-exp-0827',
  
  // Gemini 2.0 Series
  GEMINI_2_0_FLASH = 'gemini-2.0-flash',
  GEMINI_2_0_FLASH_001 = 'gemini-2.0-flash-001',
  GEMINI_2_0_FLASH_EXP = 'gemini-2.0-flash-exp',
  GEMINI_2_0_FLASH_LITE = 'gemini-2.0-flash-lite',
  GEMINI_2_0_FLASH_LITE_001 = 'gemini-2.0-flash-lite-001',
  GEMINI_2_0_FLASH_THINKING_EXP = 'gemini-2.0-flash-thinking-exp',
  GEMINI_2_0_FLASH_THINKING_EXP_01_21 = 'gemini-2.0-flash-thinking-exp-01-21',
  GEMINI_2_0_PRO_EXP_02_05 = 'gemini-2.0-pro-exp-02-05',
  GEMINI_2_0_FLASH_PREVIEW_IMAGE_GENERATION = 'gemini-2.0-flash-preview-image-generation',
  
  // Gemini 2.5 Series
  GEMINI_2_5_PRO = 'gemini-2.5-pro',
  GEMINI_2_5_PRO_EXP_03_25 = 'gemini-2.5-pro-exp-03-25',
  GEMINI_2_5_PRO_PREVIEW_03_25 = 'gemini-2.5-pro-preview-03-25',
  GEMINI_2_5_PRO_PREVIEW_05_06 = 'gemini-2.5-pro-preview-05-06',
  GEMINI_2_5_PRO_PREVIEW_06_05 = 'gemini-2.5-pro-preview-06-05',
  GEMINI_2_5_PRO_PREVIEW_TTS = 'gemini-2.5-pro-preview-tts',
  GEMINI_2_5_FLASH = 'gemini-2.5-flash',
  GEMINI_2_5_FLASH_PREVIEW_04_17 = 'gemini-2.5-flash-preview-04-17',
  GEMINI_2_5_FLASH_PREVIEW_05_20 = 'gemini-2.5-flash-preview-05-20',
  GEMINI_2_5_FLASH_PREVIEW_TTS = 'gemini-2.5-flash-preview-tts',
  GEMINI_2_5_FLASH_LITE = 'gemini-2.5-flash-lite',
  GEMINI_2_5_FLASH_LITE_PREVIEW_06_17 = 'gemini-2.5-flash-lite-preview-06-17',
  
  // Experimental Models
  GEMINI_PRO_EXPERIMENTAL = 'gemini-pro-experimental',
  GEMINI_FLASH_EXPERIMENTAL = 'gemini-flash-experimental',
  
  // Medical Models
  MEDLM_MEDIUM = 'medlm-medium',
  MEDLM_LARGE = 'medlm-large',
  
  // ========== Mistral Models ==========
  
  MISTRAL_TINY = 'mistral/mistral-tiny',
  MISTRAL_SMALL = 'mistral/mistral-small',
  MISTRAL_SMALL_LATEST = 'mistral/mistral-small-latest',
  MISTRAL_MEDIUM = 'mistral/mistral-medium',
  MISTRAL_MEDIUM_LATEST = 'mistral/mistral-medium-latest',
  MISTRAL_MEDIUM_2505 = 'mistral/mistral-medium-2505',
  MISTRAL_MEDIUM_2312 = 'mistral/mistral-medium-2312',
  MISTRAL_LARGE_LATEST = 'mistral/mistral-large-latest',
  MISTRAL_LARGE_2411 = 'mistral/mistral-large-2411',
  MISTRAL_LARGE_2402 = 'mistral/mistral-large-2402',
  MISTRAL_LARGE_2407 = 'mistral/mistral-large-2407',
  MISTRAL_NEMO = 'mistral/open-mistral-nemo',
  MISTRAL_NEMO_2407 = 'mistral/open-mistral-nemo-2407',
  MISTRAL_7B = 'mistral/open-mistral-7b',
  MIXTRAL_8X7B = 'mistral/open-mixtral-8x7b',
  MIXTRAL_8X22B = 'mistral/open-mixtral-8x22b',
  PIXTRAL_LARGE_LATEST = 'mistral/pixtral-large-latest',
  PIXTRAL_LARGE_2411 = 'mistral/pixtral-large-2411',
  PIXTRAL_12B_2409 = 'mistral/pixtral-12b-2409',
  CODESTRAL_LATEST = 'mistral/codestral-latest',
  CODESTRAL_2405 = 'mistral/codestral-2405',
  CODESTRAL_MAMBA_LATEST = 'mistral/codestral-mamba-latest',
  OPEN_CODESTRAL_MAMBA = 'mistral/open-codestral-mamba',
  DEVSTRAL_SMALL_2505 = 'mistral/devstral-small-2505',
  DEVSTRAL_SMALL_2507 = 'mistral/devstral-small-2507',
  DEVSTRAL_MEDIUM_2507 = 'mistral/devstral-medium-2507',
  MAGISTRAL_MEDIUM_LATEST = 'mistral/magistral-medium-latest',
  MAGISTRAL_MEDIUM_2506 = 'mistral/magistral-medium-2506',
  MAGISTRAL_SMALL_LATEST = 'mistral/magistral-small-latest',
  MAGISTRAL_SMALL_2506 = 'mistral/magistral-small-2506',
  MISTRAL_EMBED = 'mistral/mistral-embed',
  
  // ========== DeepSeek Models ==========
  
  DEEPSEEK_CHAT = 'deepseek/deepseek-chat',
  DEEPSEEK_CODER = 'deepseek/deepseek-coder',
  DEEPSEEK_REASONER = 'deepseek/deepseek-reasoner',
  DEEPSEEK_R1 = 'deepseek/deepseek-r1',
  DEEPSEEK_V3 = 'deepseek/deepseek-v3',
  
  // ========== XAI (Grok) Models ==========
  
  GROK_BETA = 'xai/grok-beta',
  GROK_VISION_BETA = 'xai/grok-vision-beta',
  GROK_2 = 'xai/grok-2',
  GROK_2_LATEST = 'xai/grok-2-latest',
  GROK_2_1212 = 'xai/grok-2-1212',
  GROK_2_VISION = 'xai/grok-2-vision',
  GROK_2_VISION_LATEST = 'xai/grok-2-vision-latest',
  GROK_2_VISION_1212 = 'xai/grok-2-vision-1212',
  GROK_3 = 'xai/grok-3',
  GROK_3_LATEST = 'xai/grok-3-latest',
  GROK_3_BETA = 'xai/grok-3-beta',
  GROK_3_FAST_BETA = 'xai/grok-3-fast-beta',
  GROK_3_FAST_LATEST = 'xai/grok-3-fast-latest',
  GROK_3_MINI = 'xai/grok-3-mini',
  GROK_3_MINI_LATEST = 'xai/grok-3-mini-latest',
  GROK_3_MINI_BETA = 'xai/grok-3-mini-beta',
  GROK_3_MINI_FAST = 'xai/grok-3-mini-fast',
  GROK_3_MINI_FAST_LATEST = 'xai/grok-3-mini-fast-latest',
  GROK_3_MINI_FAST_BETA = 'xai/grok-3-mini-fast-beta',
  GROK_4 = 'xai/grok-4',
  GROK_4_LATEST = 'xai/grok-4-latest',
  GROK_4_0709 = 'xai/grok-4-0709',
  
  // ========== Groq Models ==========
  
  GROQ_DEEPSEEK_R1_DISTILL_LLAMA_70B = 'groq/deepseek-r1-distill-llama-70b',
  GROQ_LLAMA_3_3_70B_VERSATILE = 'groq/llama-3.3-70b-versatile',
  GROQ_LLAMA_3_3_70B_SPECDEC = 'groq/llama-3.3-70b-specdec',
  GROQ_LLAMA_GUARD_3_8B = 'groq/llama-guard-3-8b',
  GROQ_LLAMA2_70B_4096 = 'groq/llama2-70b-4096',
  GROQ_LLAMA3_8B_8192 = 'groq/llama3-8b-8192',
  GROQ_LLAMA3_70B_8192 = 'groq/llama3-70b-8192',
  GROQ_LLAMA_3_1_8B_INSTANT = 'groq/llama-3.1-8b-instant',
  GROQ_LLAMA_3_1_70B_VERSATILE = 'groq/llama-3.1-70b-versatile',
  GROQ_LLAMA_3_1_405B_REASONING = 'groq/llama-3.1-405b-reasoning',
  GROQ_LLAMA_3_2_1B_PREVIEW = 'groq/llama-3.2-1b-preview',
  GROQ_LLAMA_3_2_3B_PREVIEW = 'groq/llama-3.2-3b-preview',
  GROQ_LLAMA_3_2_11B_TEXT_PREVIEW = 'groq/llama-3.2-11b-text-preview',
  GROQ_LLAMA_3_2_11B_VISION_PREVIEW = 'groq/llama-3.2-11b-vision-preview',
  GROQ_LLAMA_3_2_90B_TEXT_PREVIEW = 'groq/llama-3.2-90b-text-preview',
  GROQ_LLAMA_3_2_90B_VISION_PREVIEW = 'groq/llama-3.2-90b-vision-preview',
  GROQ_LLAMA3_GROQ_70B_8192_TOOL_USE_PREVIEW = 'groq/llama3-groq-70b-8192-tool-use-preview',
  GROQ_LLAMA3_GROQ_8B_8192_TOOL_USE_PREVIEW = 'groq/llama3-groq-8b-8192-tool-use-preview',
  GROQ_LLAMA_4_SCOUT_17B_16E_INSTRUCT = 'groq/meta-llama/llama-4-scout-17b-16e-instruct',
  GROQ_LLAMA_4_MAVERICK_17B_128E_INSTRUCT = 'groq/meta-llama/llama-4-maverick-17b-128e-instruct',
  GROQ_MISTRAL_SABA_24B = 'groq/mistral-saba-24b',
  GROQ_MIXTRAL_8X7B_32768 = 'groq/mixtral-8x7b-32768',
  GROQ_GEMMA_7B_IT = 'groq/gemma-7b-it',
  GROQ_GEMMA2_9B_IT = 'groq/gemma2-9b-it',
  GROQ_QWEN3_32B = 'groq/qwen/qwen3-32b',
  GROQ_KIMI_K2_INSTRUCT = 'groq/moonshotai/kimi-k2-instruct',
  GROQ_WHISPER_LARGE_V3 = 'groq/whisper-large-v3',
  GROQ_WHISPER_LARGE_V3_TURBO = 'groq/whisper-large-v3-turbo',
  GROQ_DISTIL_WHISPER_LARGE_V3_EN = 'groq/distil-whisper-large-v3-en',
  GROQ_PLAYAI_TTS = 'groq/playai-tts',
  
  // ========== Cerebras Models ==========
  
  CEREBRAS_LLAMA3_1_8B = 'cerebras/llama3.1-8b',
  CEREBRAS_LLAMA3_1_70B = 'cerebras/llama3.1-70b',
  CEREBRAS_LLAMA_3_3_70B = 'cerebras/llama-3.3-70b',
  CEREBRAS_QWEN_3_32B = 'cerebras/qwen-3-32b',
  
  // ========== FriendliAI Models ==========
  
  FRIENDLIAI_META_LLAMA_3_1_8B_INSTRUCT = 'friendliai/meta-llama-3.1-8b-instruct',
  FRIENDLIAI_META_LLAMA_3_1_70B_INSTRUCT = 'friendliai/meta-llama-3.1-70b-instruct',
  
  // ========== Meta Llama Models ==========
  
  META_LLAMA_4_SCOUT_17B_16E_INSTRUCT_FP8 = 'meta_llama/Llama-4-Scout-17B-16E-Instruct-FP8',
  META_LLAMA_4_MAVERICK_17B_128E_INSTRUCT_FP8 = 'meta_llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
  META_LLAMA_3_3_70B_INSTRUCT = 'meta_llama/Llama-3.3-70B-Instruct',
  META_LLAMA_3_3_8B_INSTRUCT = 'meta_llama/Llama-3.3-8B-Instruct',
  
  // ========== WatsonX Models ==========
  
  WATSONX_GRANITE_3_8B_INSTRUCT = 'watsonx/ibm/granite-3-8b-instruct',
  WATSONX_MISTRAL_LARGE = 'watsonx/mistralai/mistral-large',
  
  // ========== Google Legacy Models ==========
  
  TEXT_BISON = 'text-bison',
  TEXT_BISON_001 = 'text-bison@001',
  TEXT_BISON_002 = 'text-bison@002',
  TEXT_BISON32K = 'text-bison32k',
  TEXT_BISON32K_002 = 'text-bison32k@002',
  TEXT_UNICORN = 'text-unicorn',
  TEXT_UNICORN_001 = 'text-unicorn@001',
  CHAT_BISON = 'chat-bison',
  CHAT_BISON_001 = 'chat-bison@001',
  CHAT_BISON_002 = 'chat-bison@002',
  CHAT_BISON_32K = 'chat-bison-32k',
  CHAT_BISON_32K_002 = 'chat-bison-32k@002',
  CODE_BISON = 'code-bison',
  CODE_BISON_001 = 'code-bison@001',
  CODE_BISON_002 = 'code-bison@002',
  CODE_BISON32K = 'code-bison32k',
  CODE_BISON_32K_002 = 'code-bison-32k@002',
  CODE_GECKO = 'code-gecko',
  CODE_GECKO_001 = 'code-gecko@001',
  CODE_GECKO_002 = 'code-gecko@002',
  CODE_GECKO_LATEST = 'code-gecko-latest',
  CODECHAT_BISON = 'codechat-bison',
  CODECHAT_BISON_LATEST = 'codechat-bison@latest',
  CODECHAT_BISON_001 = 'codechat-bison@001',
  CODECHAT_BISON_002 = 'codechat-bison@002',
  CODECHAT_BISON_32K = 'codechat-bison-32k',
  CODECHAT_BISON_32K_002 = 'codechat-bison-32k@002',
  
  // ========== Computer Use Models ==========
  
  COMPUTER_USE_PREVIEW = 'computer-use-preview',
  
  // ========== Custom Model (for user-provided models) ==========
  
  CUSTOM = 'custom'
}

// Convenience aliases for backward compatibility
export const CLAUDE_3_OPUS = Model.CLAUDE_3_OPUS_20240229;
export const CLAUDE_3_SONNET = Model.CLAUDE_3_5_SONNET_LATEST;
export const CLAUDE_3_HAIKU = Model.CLAUDE_3_HAIKU_20240307;

/**
 * Helper function to check if a string is a valid Model enum value
 */
export const isValidModel = (model: string): model is Model => {
  return Object.values(Model).includes(model as Model);
}

/**
 * Get the model provider from a model string
 */
export const getModelProvider = (model: Model | string): string => {
  const modelStr = model.toString();
  
  if (modelStr.startsWith('gpt-') || modelStr.startsWith('o1') || modelStr.startsWith('o3') || modelStr.startsWith('o4') || 
      modelStr.startsWith('ft:') || modelStr.startsWith('text-embedding') || modelStr.startsWith('whisper') || 
      modelStr.startsWith('tts-') || modelStr.startsWith('dall-e') || modelStr.startsWith('babbage') || 
      modelStr.startsWith('davinci') || modelStr.startsWith('codex') || modelStr === 'gpt-image-1' ||
      modelStr.startsWith('omni-moderation') || modelStr.startsWith('text-moderation') || modelStr.startsWith('chatgpt')) {
    return 'openai';
  }
  
  if (modelStr.startsWith('claude-')) {
    return 'anthropic';
  }
  
  if (modelStr.startsWith('gemini-') || modelStr.startsWith('text-bison') || modelStr.startsWith('chat-bison') || 
      modelStr.startsWith('code-bison') || modelStr.startsWith('code-gecko') || modelStr.startsWith('codechat-bison') ||
      modelStr.startsWith('text-unicorn') || modelStr.startsWith('medlm-')) {
    return 'google';
  }
  
  if (modelStr.startsWith('mistral/') || modelStr.startsWith('codestral/')) {
    return 'mistral';
  }
  
  if (modelStr.startsWith('deepseek/')) {
    return 'deepseek';
  }
  
  if (modelStr.startsWith('xai/')) {
    return 'xai';
  }
  
  if (modelStr.startsWith('groq/')) {
    return 'groq';
  }
  
  if (modelStr.startsWith('cerebras/')) {
    return 'cerebras';
  }
  
  if (modelStr.startsWith('friendliai/')) {
    return 'friendliai';
  }
  
  if (modelStr.startsWith('meta_llama/')) {
    return 'meta';
  }
  
  if (modelStr.startsWith('watsonx/')) {
    return 'watsonx';
  }
  
  if (modelStr.startsWith('azure/') || modelStr.startsWith('azure_ai/')) {
    return 'azure';
  }
  
  return 'unknown';
}

/**
 * Model categories for grouping
 */
export enum ModelCategory {
  CHAT = 'chat',
  COMPLETION = 'completion',
  EMBEDDING = 'embedding',
  MODERATION = 'moderation',
  AUDIO_TRANSCRIPTION = 'audio_transcription',
  AUDIO_SPEECH = 'audio_speech',
  IMAGE_GENERATION = 'image_generation',
  VISION = 'vision',
  REASONING = 'reasoning',
  CODING = 'coding',
  RERANK = 'rerank'
}

/**
 * Get the category of a model
 */
export const getModelCategory = (model: Model | string): ModelCategory => {
  const modelStr = model.toString();
  
  // Embedding models
  if (modelStr.includes('embedding') || modelStr.includes('embed')) {
    return ModelCategory.EMBEDDING;
  }
  
  // Moderation models
  if (modelStr.includes('moderation')) {
    return ModelCategory.MODERATION;
  }
  
  // Audio models
  if (modelStr.includes('whisper') || modelStr.includes('transcribe')) {
    return ModelCategory.AUDIO_TRANSCRIPTION;
  }
  if (modelStr.includes('tts')) {
    return ModelCategory.AUDIO_SPEECH;
  }
  
  // Image models
  if (modelStr.includes('dall-e') || modelStr.includes('image') || modelStr.includes('pixtral')) {
    return ModelCategory.IMAGE_GENERATION;
  }
  
  // Vision models
  if (modelStr.includes('vision')) {
    return ModelCategory.VISION;
  }
  
  // Reasoning models
  if (modelStr.includes('reasoning') || modelStr.includes('reasoner') || modelStr.includes('thinking') || 
      modelStr.includes('o1') || modelStr.includes('o3') || modelStr.includes('o4') || modelStr.includes('r1')) {
    return ModelCategory.REASONING;
  }
  
  // Coding models
  if (modelStr.includes('code') || modelStr.includes('codestral') || modelStr.includes('devstral')) {
    return ModelCategory.CODING;
  }
  
  // Rerank models
  if (modelStr.includes('rerank')) {
    return ModelCategory.RERANK;
  }
  
  // Text completion models
  if (modelStr.includes('instruct') || modelStr.includes('babbage') || modelStr.includes('davinci') || 
      modelStr.includes('text-')) {
    return ModelCategory.COMPLETION;
  }
  
  // Default to chat
  return ModelCategory.CHAT;
}

/**
 * Export the Model enum as default for backward compatibility
 */
export default Model;