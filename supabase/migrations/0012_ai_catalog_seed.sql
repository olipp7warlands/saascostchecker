-- Ampliación del bloque 1.1 — Catálogo de herramientas de IA
-- 143 herramientas de IA nuevas en saas_catalog, agrupadas en 7 categorías
-- nuevas (ai_assistant, ai_coding, ai_image_video, ai_audio_voice,
-- ai_writing, ai_meeting_agents, ai_api_platform). Ver docs/DECISIONS.md
-- para el detalle de decisiones (constraint de category ampliado, entradas
-- recategorizadas, casos de doble candidato del matcher).
--
-- No es un bloque nuevo de TASKS.md: es una ampliación de datos sobre el
-- 1.1 ya cerrado. El único cambio de "schema" es el CHECK constraint de
-- category (en saas_catalog Y en vendors, que lo copia) — inevitable para
-- aceptar los 7 slugs nuevos; no se toca ninguna tabla/columna.

-- =========================================================================
-- 1. AMPLIAR EL CHECK CONSTRAINT DE category (saas_catalog Y vendors)
-- =========================================================================

-- El nombre del constraint no se hardcodea (aunque Postgres lo habría
-- generado como "<tabla>_category_check" por convención): se localiza en
-- pg_constraint por (tabla, columna) para no depender de una suposición no
-- verificable sin acceso a la base — este entorno de desarrollo no tiene
-- Docker/Postgres local (ver CLAUDE.md), así que no hay forma de confirmar
-- el nombre exacto antes de aplicar contra el remoto.
do $$
declare
  v_conname text;
begin
  select con.conname into v_conname
  from pg_constraint con
  join pg_attribute att
    on att.attrelid = con.conrelid
   and att.attnum = any(con.conkey)
  where con.conrelid = 'public.saas_catalog'::regclass
    and con.contype = 'c'
    and att.attname = 'category'
    and array_length(con.conkey, 1) = 1;

  if v_conname is not null then
    execute format('alter table public.saas_catalog drop constraint %I', v_conname);
  end if;
end $$;

alter table public.saas_catalog
  add constraint saas_catalog_category_check check (category in (
    'crm', 'marketing', 'sales', 'design', 'productivity', 'communication',
    'devtools', 'observability', 'security', 'analytics', 'hr', 'finance',
    'support', 'project_management', 'video', 'other',
    'ai_assistant', 'ai_coding', 'ai_image_video', 'ai_audio_voice',
    'ai_writing', 'ai_meeting_agents', 'ai_api_platform'
  ));

do $$
declare
  v_conname text;
begin
  select con.conname into v_conname
  from pg_constraint con
  join pg_attribute att
    on att.attrelid = con.conrelid
   and att.attnum = any(con.conkey)
  where con.conrelid = 'public.vendors'::regclass
    and con.contype = 'c'
    and att.attname = 'category'
    and array_length(con.conkey, 1) = 1;

  if v_conname is not null then
    execute format('alter table public.vendors drop constraint %I', v_conname);
  end if;
end $$;

alter table public.vendors
  add constraint vendors_category_check check (category in (
    'crm', 'marketing', 'sales', 'design', 'productivity', 'communication',
    'devtools', 'observability', 'security', 'analytics', 'hr', 'finance',
    'support', 'project_management', 'video', 'other',
    'ai_assistant', 'ai_coding', 'ai_image_video', 'ai_audio_voice',
    'ai_writing', 'ai_meeting_agents', 'ai_api_platform'
  ));

-- =========================================================================
-- 2. RECATEGORIZACIÓN de 3 entradas ya existentes en 0004 que son
--    claramente herramientas de IA sembradas antes de que existieran estas
--    categorías (encontradas al auditar el catálogo antes de generar la
--    ampliación — ver docs/DECISIONS.md). No son inserts nuevos: mismo
--    id/aliases, solo cambia category.
-- =========================================================================

update public.saas_catalog set category = 'ai_audio_voice' where lower(name) = 'descript';
update public.saas_catalog set category = 'ai_meeting_agents' where lower(name) = 'otter.ai';
update public.saas_catalog set category = 'ai_image_video' where lower(name) = 'synthesia';

-- =========================================================================
-- 3. 143 HERRAMIENTAS DE IA NUEVAS
-- =========================================================================
-- Generadas por 7 subagentes en paralelo (uno por categoría, mismo patrón
-- que el seed original de 1.1), cada uno con la lista completa de los 513
-- nombres ya sembrados para no duplicar. Tras la generación se hizo un
-- dedupe automatizado de nombres Y alias (no solo nombres) contra el propio
-- lote nuevo y contra el seed de 0004 — encontró y corrigió 9 colisiones de
-- alias reales entre "producto de consumo" y "API/plataforma" de la misma
-- empresa (OpenAI/ChatGPT, Anthropic/Claude, Mistral AI/Le Chat, xAI/Grok,
-- DeepSeek/DeepSeek API, Hugging Face/HuggingChat, Amazon Q/Amazon Q
-- Developer/AWS, Semrush/ContentShake AI, Vercel/v0) y una entre dos
-- productos de escritura del mismo fabricante (Writesonic/Chatsonic). En
-- cada caso se dejó el alias compartido/genérico en un solo lado y se quitó
-- del otro, en vez de dejar dos candidatos empatados a confidence 1.0 (ver
-- docs/DECISIONS.md para el detalle completo).
insert into public.saas_catalog (name, aliases, category, website, verified)
values
  ('Gemini', array['GOOGLE *GEMINI', 'GOOGLE ONE AI PREMIUM', 'GEMINI.GOOGLE.COM'], 'ai_assistant', 'gemini.google.com', true),
  ('Perplexity', array['PERPLEXITY AI', 'PERPLEXITY.AI', 'PPLX*PERPLEXITY', 'PERPLEXITY PRO'], 'ai_assistant', 'perplexity.ai', true),
  ('Microsoft Copilot', array['MICROSOFT*COPILOT', 'MSFT *COPILOT PRO', 'COPILOT.MICROSOFT.COM'], 'ai_assistant', 'copilot.microsoft.com', true),
  ('Meta AI', array['META AI', 'META PLATFORMS INC', 'META.AI'], 'ai_assistant', 'meta.ai', true),
  ('Grok', array['GROK.COM', 'XAI *GROK'], 'ai_assistant', 'grok.com', true),
  ('Poe', array['QUORA INC POE', 'POE.COM', 'QUORA *POE SUB'], 'ai_assistant', 'poe.com', true),
  ('Pi', array['INFLECTION AI', 'PI.AI', 'INFLECTION AI PI'], 'ai_assistant', 'pi.ai', true),
  ('You.com', array['YOU.COM', 'YOU INC', 'YOU.COM PRO'], 'ai_assistant', 'you.com', true),
  ('Character.AI', array['CHARACTER TECHNOLOGIES', 'CHARACTER.AI', 'C.AI PLUS'], 'ai_assistant', 'character.ai', true),
  ('DeepSeek', array['DEEPSEEK', 'HANGZHOU DEEPSEEK', 'DEEPSEEK.COM'], 'ai_assistant', 'deepseek.com', true),
  ('Le Chat', array['LE CHAT MISTRAL', 'CHAT.MISTRAL.AI', 'MISTRAL.AI PRO'], 'ai_assistant', 'chat.mistral.ai', true),
  ('Replika', array['LUKA INC REPLIKA', 'REPLIKA.AI', 'REPLIKA PRO'], 'ai_assistant', 'replika.ai', true),
  ('Kimi', array['MOONSHOT AI', 'KIMI.MOONSHOT.CN', 'BEIJING MOONSHOT'], 'ai_assistant', 'kimi.moonshot.cn', true),
  ('Ernie Bot', array['BAIDU INC', 'ERNIE BOT', 'YIYAN.BAIDU.COM'], 'ai_assistant', 'yiyan.baidu.com', true),
  ('Amazon Q', array['AWS*AMAZON Q', 'AMAZON Q BUSINESS'], 'ai_assistant', 'aws.amazon.com', true),
  ('Yandex Alisa', array['YANDEX LLC', 'ALISA YANDEX', 'YANDEX.RU'], 'ai_assistant', 'yandex.ru', true),
  ('Naver Clova X', array['NAVER CORP', 'CLOVA X', 'NAVER.COM'], 'ai_assistant', 'naver.com', true),
  ('Cursor', array['ANYSPHERE INC', 'CURSOR AI POWERED IDE', 'CURSOR.SH', 'CURSOR AI'], 'ai_coding', 'cursor.com', true),
  ('Windsurf', array['EXAFUNCTION INC', 'WINDSURF AI', 'WINDSURF.COM'], 'ai_coding', 'windsurf.com', true),
  ('Codeium', array['CODEIUM INC', 'CODEIUM.COM', 'CODEIUM AI'], 'ai_coding', 'codeium.com', true),
  ('Replit', array['REPLIT INC', 'REPLIT.COM', 'REPLIT AGENT', 'REPL.IT'], 'ai_coding', 'replit.com', true),
  ('v0', array['V0.DEV', 'V0 BY VERCEL', 'V0.APP'], 'ai_coding', 'v0.dev', true),
  ('Lovable', array['LOVABLE LABS', 'LOVABLE.DEV', 'GPT ENGINEER AB'], 'ai_coding', 'lovable.dev', true),
  ('Bolt.new', array['STACKBLITZ INC', 'BOLT.NEW', 'BOLT NEW'], 'ai_coding', 'bolt.new', true),
  ('Tabnine', array['TABNINE LTD', 'TABNINE.COM', 'TABNINE INC'], 'ai_coding', 'tabnine.com', true),
  ('Sourcegraph Cody', array['SOURCEGRAPH INC', 'CODY AI', 'SOURCEGRAPH.COM'], 'ai_coding', 'sourcegraph.com', true),
  ('Amazon Q Developer', array['AWS Q DEVELOPER', 'AMZN Q DEVELOPER'], 'ai_coding', 'aws.amazon.com', true),
  ('Devin', array['COGNITION LABS', 'COGNITION AI', 'DEVIN AI'], 'ai_coding', 'cognition.ai', true),
  ('Cline', array['CLINE BOT', 'CLINE.BOT', 'CLINE AI'], 'ai_coding', 'cline.bot', true),
  ('Continue', array['CONTINUE DEV INC', 'CONTINUE.DEV', 'CONTINUE AI'], 'ai_coding', 'continue.dev', true),
  ('JetBrains AI Assistant', array['JETBRAINS S.R.O.', 'JETBRAINS AI', 'JETBRAINS.COM'], 'ai_coding', 'jetbrains.com', true),
  ('Sweep', array['SWEEP AI INC', 'SWEEP.DEV', 'SWEEP AI'], 'ai_coding', 'sweep.dev', true),
  ('Aider', array['AIDER.CHAT', 'AIDER AI', 'AIDER CODING'], 'ai_coding', 'aider.chat', true),
  ('Qodo', array['QODO LTD', 'QODO.AI', 'CODIUM AI LTD'], 'ai_coding', 'qodo.ai', true),
  ('Supermaven', array['SUPERMAVEN INC', 'SUPERMAVEN.COM', 'SUPERMAVEN AI'], 'ai_coding', 'supermaven.com', true),
  ('Warp', array['WARP.DEV', 'WARP TERMINAL', 'WARP INC'], 'ai_coding', 'warp.dev', true),
  ('Phind', array['PHIND INC', 'PHIND.COM', 'PHIND AI'], 'ai_coding', 'phind.com', true),
  ('Zed', array['ZED INDUSTRIES', 'ZED.DEV', 'ZED EDITOR'], 'ai_coding', 'zed.dev', true),
  ('CodeRabbit', array['CODERABBIT INC', 'CODERABBIT.AI', 'CODERABBIT AI'], 'ai_coding', 'coderabbit.ai', true),
  ('Augment Code', array['AUGMENT COMPUTING', 'AUGMENTCODE.COM', 'AUGMENT CODE'], 'ai_coding', 'augmentcode.com', true),
  ('Midjourney', array['MIDJOURNEY INC', 'MIDJOURNEY.COM', 'MID JOURNEY'], 'ai_image_video', 'midjourney.com', true),
  ('Runway', array['RUNWAYML.COM', 'RUNWAY AI INC', 'RUNWAY'], 'ai_image_video', 'runwayml.com', true),
  ('Leonardo.Ai', array['LEONARDO.AI', 'LEONARDO INTERACTIVE', 'LEONARDOAI'], 'ai_image_video', 'leonardo.ai', true),
  ('Ideogram', array['IDEOGRAM.AI', 'IDEOGRAM INC', 'IDEOGRAM'], 'ai_image_video', 'ideogram.ai', true),
  ('Pika', array['PIKA LABS', 'PIKA.ART', 'PIKA INC'], 'ai_image_video', 'pika.art', true),
  ('Luma AI', array['LUMA LABS', 'LUMALABS.AI', 'LUMA AI INC'], 'ai_image_video', 'lumalabs.ai', true),
  ('Stability AI', array['STABILITY AI LTD', 'DREAMSTUDIO', 'STABILITY.AI'], 'ai_image_video', 'stability.ai', true),
  ('Adobe Firefly', array['ADOBE FIREFLY', 'ADOBE *FIREFLY', 'FIREFLY.ADOBE.COM'], 'ai_image_video', 'firefly.adobe.com', true),
  ('Kling AI', array['KLING AI', 'KLINGAI.COM', 'KUAISHOU TECHNOLOGY'], 'ai_image_video', 'klingai.com', true),
  ('Hailuo AI', array['HAILUO AI', 'MINIMAX', 'HAILUOAI.COM'], 'ai_image_video', 'hailuoai.com', true),
  ('Krea', array['KREA.AI', 'KREA INC'], 'ai_image_video', 'krea.ai', true),
  ('Recraft', array['RECRAFT.AI', 'RECRAFT INC'], 'ai_image_video', 'recraft.ai', true),
  ('Playground AI', array['PLAYGROUND AI', 'PLAYGROUND.COM', 'PLAYGROUNDAI'], 'ai_image_video', 'playground.com', true),
  ('Freepik AI', array['FREEPIK.COM', 'FREEPIK COMPANY SL', 'FS *FREEPIK'], 'ai_image_video', 'freepik.com', true),
  ('Flux Black Forest Labs', array['BLACK FOREST LABS', 'BFL.AI', 'BLACKFORESTLABS'], 'ai_image_video', 'blackforestlabs.ai', true),
  ('HeyGen', array['HEYGEN INC', 'HEYGEN.COM', 'HEY GEN'], 'ai_image_video', 'heygen.com', true),
  ('D-ID', array['D-ID.COM', 'D-ID INC', 'DID*STUDIO'], 'ai_image_video', 'd-id.com', true),
  ('Topaz Labs', array['TOPAZ LABS LLC', 'TOPAZLABS.COM', 'TOPAZ VIDEO AI'], 'ai_image_video', 'topazlabs.com', true),
  ('Civitai', array['CIVITAI.COM', 'CIVITAI INC'], 'ai_image_video', 'civitai.com', true),
  ('PixVerse', array['PIXVERSE.AI', 'PIXVERSE INC'], 'ai_image_video', 'pixverse.ai', true),
  ('Viggle', array['VIGGLE.AI', 'VIGGLE INC'], 'ai_image_video', 'viggle.ai', true),
  ('Magnific AI', array['MAGNIFIC.AI', 'MAGNIFIC INC'], 'ai_image_video', 'magnific.ai', true),
  ('NightCafe', array['NIGHTCAFE STUDIO', 'NIGHTCAFE.STUDIO', 'NIGHT CAFE CREATOR'], 'ai_image_video', 'nightcafe.studio', true),
  ('Artbreeder', array['ARTBREEDER.COM', 'ARTBREEDER INC'], 'ai_image_video', 'artbreeder.com', true),
  ('Suno', array['SUNO.COM', 'SUNO AI', 'SUNO INC'], 'ai_audio_voice', 'suno.com', true),
  ('Udio', array['UDIO.COM', 'UDIO AI', 'UDIO INC'], 'ai_audio_voice', 'udio.com', true),
  ('LMNT', array['LMNT.COM', 'LMNT INC', 'LMNT SPEECH'], 'ai_audio_voice', 'lmnt.com', true),
  ('Resemble AI', array['RESEMBLE.AI', 'RESEMBLE AI INC', 'RESEMBLEAI'], 'ai_audio_voice', 'resemble.ai', true),
  ('WellSaid Labs', array['WELLSAID LABS', 'WELLSAIDLABS.COM', 'WELLSAID'], 'ai_audio_voice', 'wellsaidlabs.com', true),
  ('Play.ht', array['PLAY.HT', 'PLAYHT INC', 'PLAYHT'], 'ai_audio_voice', 'play.ht', true),
  ('Murf AI', array['MURF.AI', 'MURF AI INC', 'MURF SOFTWARE'], 'ai_audio_voice', 'murf.ai', true),
  ('Voicemod', array['VOICEMOD', 'VOICEMOD S.L.', 'VOICEMOD.NET'], 'ai_audio_voice', 'voicemod.net', true),
  ('Krisp', array['KRISP.AI', '2HZ INC', 'KRISP TECHNOLOGIES'], 'ai_audio_voice', 'krisp.ai', true),
  ('Adobe Podcast', array['ADOBE *PODCAST', 'ADOBE PODCAST'], 'ai_audio_voice', 'adobe.com', true),
  ('AssemblyAI', array['ASSEMBLYAI', 'ASSEMBLYAI.COM', 'ASSEMBLY AI INC'], 'ai_audio_voice', 'assemblyai.com', true),
  ('Deepgram', array['DEEPGRAM', 'DEEPGRAM.COM', 'DEEPGRAM INC'], 'ai_audio_voice', 'deepgram.com', true),
  ('Podcastle', array['PODCASTLE', 'PODCASTLE.AI', 'PODCASTLE INC'], 'ai_audio_voice', 'podcastle.ai', true),
  ('Speechify', array['SPEECHIFY', 'SPEECHIFY INC', 'SPEECHIFY.COM'], 'ai_audio_voice', 'speechify.com', true),
  ('Sonantic', array['SONANTIC', 'SONANTIC.IO', 'SONANTIC LTD'], 'ai_audio_voice', 'sonantic.io', true),
  ('Replica Studios', array['REPLICA STUDIOS', 'REPLICASTUDIOS.COM', 'REPLICA STUDIOS AI'], 'ai_audio_voice', 'replicastudios.com', true),
  ('AIVA', array['AIVA TECHNOLOGIES', 'AIVA.AI', 'AIVA'], 'ai_audio_voice', 'aiva.ai', true),
  ('Endel', array['ENDEL', 'ENDEL.IO', 'ENDEL SOUND'], 'ai_audio_voice', 'endel.io', true),
  ('ElevenLabs', array['ELEVENLABS.IO', 'ELEVENLABS INC', 'ELEVEN LABS'], 'ai_audio_voice', 'elevenlabs.io', true),
  ('Jasper', array['JASPER AI', 'JASPER.AI', 'PADDLE.NET* JASPER'], 'ai_writing', 'jasper.ai', true),
  ('Copy.ai', array['COPY.AI', 'COPYAI INC', 'STRIPE * COPY.AI'], 'ai_writing', 'copy.ai', true),
  ('Writer', array['WRITER.COM', 'WRITER INC', 'QORDOBA INC'], 'ai_writing', 'writer.com', true),
  ('Sudowrite', array['SUDOWRITE', 'SUDOWRITE.COM', 'FS *SUDOWRITE'], 'ai_writing', 'sudowrite.com', true),
  ('Rytr', array['RYTR.ME', 'RYTR LLC', 'PADDLE.NET* RYTR'], 'ai_writing', 'rytr.me', true),
  ('Wordtune', array['WORDTUNE', 'WORDTUNE.COM', 'AI21 LABS WORDTUNE'], 'ai_writing', 'wordtune.com', true),
  ('QuillBot', array['QUILLBOT', 'QUILLBOT.COM', 'COURSE HERO INC'], 'ai_writing', 'quillbot.com', true),
  ('Lex', array['LEX.PAGE', 'NARRATIVE AI INC', 'LEX'], 'ai_writing', 'lex.page', true),
  ('Copysmith', array['COPYSMITH', 'COPYSMITH.AI', 'COPYSMITH INC'], 'ai_writing', 'copysmith.ai', true),
  ('Anyword', array['ANYWORD', 'ANYWORD.COM', 'ANYWORD LTD'], 'ai_writing', 'anyword.com', true),
  ('ContentShake AI', array['SEMRUSH CONTENTSHAKE', 'CONTENTSHAKE AI'], 'ai_writing', 'contentshake.semrush.com', true),
  ('Frase', array['FRASE.IO', 'FRASE', 'FRASE TECHNOLOGIES'], 'ai_writing', 'frase.io', true),
  ('Surfer AI', array['SURFER SEO', 'SURFERSEO.COM', 'SURFER AI'], 'ai_writing', 'surferseo.com', true),
  ('Hypotenuse AI', array['HYPOTENUSE AI', 'HYPOTENUSE.AI', 'HYPOTENUSE PTE LTD'], 'ai_writing', 'hypotenuse.ai', true),
  ('Simplified', array['SIMPLIFIED', 'SIMPLIFIED.COM', 'SIMPLIFIED INC'], 'ai_writing', 'simplified.com', true),
  ('Writesonic', array['WRITESONIC', 'WRITESONIC.COM', 'PADDLE.NET* WRITESONIC'], 'ai_writing', 'writesonic.com', true),
  ('Peppertype.ai', array['PEPPERTYPE', 'PEPPERTYPE.AI', 'PEPPER CONTENT'], 'ai_writing', 'peppertype.ai', true),
  ('Textio', array['TEXTIO', 'TEXTIO.COM', 'TEXTIO INC'], 'ai_writing', 'textio.com', true),
  ('Jenni AI', array['JENNI AI', 'JENNI.AI', 'JENNI TECHNOLOGIES'], 'ai_writing', 'jenni.ai', true),
  ('Neuroflash', array['NEUROFLASH', 'NEUROFLASH.COM', 'NEUROFLASH GMBH'], 'ai_writing', 'neuroflash.com', true),
  ('Fireflies.ai', array['FIREFLIES.AI', 'FIREFLIES AI INC', 'FIREFLIES'], 'ai_meeting_agents', 'fireflies.ai', true),
  ('Fathom', array['FATHOM VIDEO INC', 'FATHOM.VIDEO', 'FATHOM AI'], 'ai_meeting_agents', 'fathom.video', true),
  ('Lindy', array['PADDLE.NET* LINDY', 'LINDY.AI', 'LINDY AI INC'], 'ai_meeting_agents', 'lindy.ai', true),
  ('Grain', array['GRAIN.COM', 'GRAIN LABS INC', 'GRAIN TECHNOLOGIES'], 'ai_meeting_agents', 'grain.com', true),
  ('tldv', array['TLDV.IO', 'TL;DV GMBH', 'TLDV'], 'ai_meeting_agents', 'tldv.io', true),
  ('Avoma', array['AVOMA INC', 'AVOMA.COM', 'AVOMA'], 'ai_meeting_agents', 'avoma.com', true),
  ('Rewatch', array['REWATCH INC', 'REWATCH.COM', 'REWATCH'], 'ai_meeting_agents', 'rewatch.com', true),
  ('Fellow', array['FELLOW.APP', 'FELLOW INC', 'FELLOW'], 'ai_meeting_agents', 'fellow.app', true),
  ('Sana', array['SANA LABS AB', 'SANALABS.COM', 'SANA AI'], 'ai_meeting_agents', 'sanalabs.com', true),
  ('Supernormal', array['PADDLE.NET* SUPERNORMAL', 'SUPERNORMAL.COM', 'SUPERNORMAL INC'], 'ai_meeting_agents', 'supernormal.com', true),
  ('Read AI', array['READ AI INC', 'READ.AI', 'READAI'], 'ai_meeting_agents', 'read.ai', true),
  ('MeetGeek', array['MEETGEEK.AI', 'MEETGEEK INC', 'MEETGEEK'], 'ai_meeting_agents', 'meetgeek.ai', true),
  ('Bluedot', array['BLUEDOT.AI', 'BLUEDOT INC', 'BLUEDOT'], 'ai_meeting_agents', 'bluedot.ai', true),
  ('Sembly', array['SEMBLY.AI', 'SEMBLY INC', 'SEMBLY'], 'ai_meeting_agents', 'sembly.ai', true),
  ('Circleback', array['FS *CIRCLEBACK', 'CIRCLEBACK.AI', 'CIRCLEBACK INC'], 'ai_meeting_agents', 'circleback.ai', true),
  ('Notta', array['NOTTA INC', 'NOTTA.AI', 'NOTTA'], 'ai_meeting_agents', 'notta.ai', true),
  ('Mistral AI', array['MISTRAL AI', 'MISTRAL AI PARIS FRA', 'LA PLATEFORME MISTRAL'], 'ai_api_platform', 'mistral.ai', true),
  ('Cohere', array['COHERE INC', 'COHERE TORONTO', 'COHERE.COM'], 'ai_api_platform', 'cohere.com', true),
  ('Hugging Face', array['HUGGING FACE INC', 'HUGGINGFACE.CO', 'HUGGING FACE NYC'], 'ai_api_platform', 'huggingface.co', true),
  ('Replicate', array['REPLICATE INC', 'REPLICATE.COM', 'REPLICATE SF'], 'ai_api_platform', 'replicate.com', true),
  ('Together AI', array['TOGETHER AI INC', 'TOGETHER COMPUTER INC', 'TOGETHER.AI'], 'ai_api_platform', 'together.ai', true),
  ('Groq', array['GROQ INC', 'GROQ.COM', 'GROQCLOUD'], 'ai_api_platform', 'groq.com', true),
  ('Fireworks AI', array['FIREWORKS AI INC', 'FIREWORKS.AI', 'FIREWORKS AI SAN FRANCISCO CA'], 'ai_api_platform', 'fireworks.ai', true),
  ('OpenRouter', array['OPENROUTER INC', 'OPENROUTER.AI', 'OPENROUTER LLC'], 'ai_api_platform', 'openrouter.ai', true),
  ('DeepSeek API', array['DEEPSEEK API', 'DEEPSEEK PLATFORM', 'HANGZHOU DEEPSEEK AI CHN'], 'ai_api_platform', 'platform.deepseek.com', true),
  ('xAI API', array['XAI CORP', 'X.AI', 'XAI GROK API'], 'ai_api_platform', 'x.ai', true),
  ('AWS Bedrock', array['AWS BEDROCK', 'AMAZON WEB SERVICES BEDROCK', 'AWS*BEDROCK'], 'ai_api_platform', 'aws.amazon.com', true),
  ('Google Vertex AI', array['GOOGLE CLOUD VERTEX AI', 'GOOGLE *CLOUD VERTEX', 'GCP VERTEX AI'], 'ai_api_platform', 'cloud.google.com', true),
  ('Azure OpenAI Service', array['MICROSOFT AZURE OPENAI', 'MSFT AZURE OPENAI SVC', 'AZURE OPENAI SERVICE'], 'ai_api_platform', 'azure.microsoft.com', true),
  ('Cerebras', array['CEREBRAS SYSTEMS', 'CEREBRAS.AI', 'CEREBRAS INFERENCE'], 'ai_api_platform', 'cerebras.ai', true),
  ('Modal', array['MODAL LABS INC', 'MODAL.COM', 'MODAL LABS'], 'ai_api_platform', 'modal.com', true),
  ('Baseten', array['BASETEN LABS INC', 'BASETEN.CO', 'BASETEN INC'], 'ai_api_platform', 'baseten.co', true),
  ('Runpod', array['RUNPOD INC', 'RUNPOD.IO', 'RUNPOD CLOUD'], 'ai_api_platform', 'runpod.io', true),
  ('Anyscale', array['ANYSCALE INC', 'ANYSCALE.COM', 'ANYSCALE ENDPOINTS'], 'ai_api_platform', 'anyscale.com', true),
  ('Perplexity API', array['PERPLEXITY AI INC', 'PPLX API'], 'ai_api_platform', 'perplexity.ai', true),
  ('AI21 Labs', array['AI21 LABS LTD', 'AI21.COM', 'AI21 LABS ISRAEL'], 'ai_api_platform', 'ai21.com', true),
  -- Los 5 pares "consumo vs. API/plataforma" se sembraron a mano (no por
  -- subagente) para controlar con precisión sus alias y garantizar los
  -- casos de doble candidato pedidos explícitamente — ver docs/DECISIONS.md
  -- para la traza exacta de cómo best_catalog_match() resuelve cada uno.
  ('ChatGPT', array['OPENAI *CHATGPT SUBSCR', 'CHATGPT SUBSCR', 'CHATGPT PLUS'], 'ai_assistant', 'chatgpt.com', true),
  ('OpenAI API', array['OPENAI', 'OPENAI LLC', 'OPENAI *API'], 'ai_api_platform', 'platform.openai.com', true),
  ('Claude', array['ANTHROPIC PBC', 'CLAUDE.AI', 'ANTHROPIC *CLAUDE'], 'ai_assistant', 'claude.ai', true),
  ('Anthropic API', array['ANTHROPIC API', 'CONSOLE.ANTHROPIC.COM'], 'ai_api_platform', 'console.anthropic.com', true),
  ('GitHub Copilot', array['GITHUB *COPILOT', 'GITHUB COPILOT'], 'ai_coding', 'github.com', true);
