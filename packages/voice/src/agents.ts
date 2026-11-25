import type { Bolna } from './bolna';

/**
 * The demo voice agents on Bolna, defined in code (reviewable, reproducible; `pnpm voice:setup`).
 * Northwind Energy is a DEMO company. The scam caller pretends to be a real bank: real brands appear
 * only as the name a scammer pretends to be (project rule).
 */
export interface AgentDefinition {
  name: string;
  /** May use {variables} filled per call from `user_data`. */
  welcome: string;
  prompt: string;
  /** Hard limit on call length, seconds. */
  maxSeconds: number;
}

export const LINE_TEST_AGENT: AgentDefinition = {
  name: 'Cachet line test (demo)',
  welcome:
    'Hello! This is a short line test from Cachet, the seal on every AI call. No action is needed. Goodbye.',
  prompt:
    'You are a line-test voice for Cachet. You already said the line test message. If the person says anything, reply in one short sentence that this is only a test and say goodbye.',
  maxSeconds: 30,
};

/**
 * Northwind's AI caller. Its first sentence is EXACTLY the `firstLine` Cachet returned with the seal
 * (AI disclosure + spoken call code), so what the voice says always matches the Telegram card.
 */
export const NORTHWIND_AGENT: AgentDefinition = {
  name: 'Northwind billing assistant (demo)',
  welcome: '{first_line}',
  prompt: [
    'You are the AI billing assistant of {company}, a DEMO energy company used to show Cachet. You are on a phone call with a customer and you have ALREADY said: "{first_line}".',
    'Facts for this call: reason: {message}. Amount: {amount_text}. Your Cachet code: {code_spoken}.',
    'Rules:',
    '- Always be honest that you are an AI assistant. Reply in at most two short sentences.',
    '- If asked for the code, repeat it slowly: {code_spoken}.',
    '- Tell the customer they can check this call in their Cachet chat on Telegram, and pay with the "Pay safely" button there if they want.',
    '- Never ask for OTPs, passwords, PINs, card numbers or bank details. Never ask them to pay any other way.',
    '- If they want to end the call, thank them and say goodbye.',
    'Speak English.',
  ].join('\n'),
  maxSeconds: 150,
};

/**
 * The demo's "no seal" call: an AI call WITHOUT a Cachet seal, so no card appears and /check says
 * "not verified". It is honest about being a demo and asks for nothing. We do NOT make AI voices
 * that act out phishing: Bolna's moderation blocked two such versions (a real bank, then a fictional
 * one asking for a code), and working around a provider's safety filter is not something we do.
 * For the video, the dramatic scam call is played by a real person (staged, labelled).
 */
export const UNVERIFIED_AGENT: AgentDefinition = {
  name: 'Unsealed caller (demo)',
  welcome:
    'Hello. This is a Cachet safety demo. I am an AI caller with no Cachet seal, the way a scammer would call you. Please check your Cachet chat on Telegram.',
  prompt: [
    'You are the "unsealed caller" in a Cachet safety demonstration. You have NO Cachet seal.',
    'Explain in one or two short sentences: there is no green Cachet card for this call, and asking the Cachet bot /check will say "not verified", so a real person should hang up.',
    'Never ask for any personal information, codes, passwords or money. Never pretend to be a real company.',
    'After at most three turns, say goodbye and end the call.',
  ].join('\n'),
  maxSeconds: 60,
};

/** Bolna agent body (v2): Deepgram → OpenAI → ElevenLabs over Plivo (Bolna's quickstart stack). */
export function bolnaAgentBody(def: AgentDefinition) {
  return {
    agent_config: {
      agent_name: def.name,
      agent_welcome_message: def.welcome,
      tasks: [
        {
          task_type: 'conversation',
          toolchain: { execution: 'sequential', pipelines: [['transcriber', 'llm', 'synthesizer']] },
          tools_config: {
            llm_agent: {
              agent_type: 'simple_llm_agent',
              agent_flow_type: 'streaming',
              llm_config: { provider: 'openai', model: 'gpt-4.1-mini', max_tokens: 120, temperature: 0.3 },
            },
            synthesizer: {
              provider: 'elevenlabs',
              provider_config: {
                voice: 'Angelica',
                voice_id: 'IkSv4tkouLJ6kYsQA7XD',
                model: 'eleven_turbo_v2_5',
              },
              stream: true,
              buffer_size: 250,
              audio_format: 'wav',
            },
            transcriber: {
              provider: 'deepgram',
              model: 'nova-3',
              language: 'en',
              stream: true,
              encoding: 'linear16',
              sampling_rate: 16000,
              endpointing: 250,
            },
            input: { provider: 'plivo', format: 'wav' },
            output: { provider: 'plivo', format: 'wav' },
          },
          task_config: { call_terminate: def.maxSeconds, hangup_after_silence: 10 },
        },
      ],
    },
    agent_prompts: { task_1: { system_prompt: def.prompt } },
  };
}

/** Create the agent, or update it if one with this name exists. Returns its id. */
export async function ensureAgent(
  bolna: Bolna,
  def: AgentDefinition,
): Promise<{ id: string; created: boolean }> {
  const existing = (await bolna.listAgents()).find((a) => a.agent_name === def.name);
  if (existing) {
    await bolna.updateAgent(existing.id, bolnaAgentBody(def));
    return { id: existing.id, created: false };
  }
  const made = await bolna.createAgent(bolnaAgentBody(def));
  return { id: made.agent_id, created: true };
}

/** Find an agent's id by name (agents are created by `pnpm voice:setup`). */
export async function agentIdByName(bolna: Bolna, name: string): Promise<string | null> {
  return (await bolna.listAgents()).find((a) => a.agent_name === name)?.id ?? null;
}
