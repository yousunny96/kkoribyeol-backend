import './env.js';
import { Body, Controller, HttpCode, Logger, Post, ServiceUnavailableException } from '@nestjs/common';
import { Fields } from './fields.js';

interface DifyResource {
  document_name?: string;
  segment_position?: number;
  content?: string;
  score?: number;
}

/**
 * 규정 묻기. 코어 웹 → 이 백엔드 → Dify 챗봇 순서로 간다.
 * Dify API 키는 브라우저에 보이면 누구나 가져다 쓸 수 있어서, 서버 환경변수에만 둔다.
 */
@Controller('rules')
export class RulesController {
  private readonly log = new Logger('Rules');

  @Post('ask')
  @HttpCode(200)
  async ask(@Body() body: unknown) {
    const f = new Fields(body);
    const question = f.text('question', '질문', { max: 500 })!;
    const conversationId = f.text('conversationId', '대화 id', { optional: true, max: 100 });
    f.check();

    const key = process.env.DIFY_API_KEY;
    if (!key) throw new ServiceUnavailableException({ message: '규정 챗봇이 아직 연결되지 않았어요.' });
    const base = process.env.DIFY_API_URL ?? 'https://api.dify.ai/v1';

    let res: Response;
    try {
      res = await fetch(`${base}/chat-messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          inputs: {},
          query: question,
          response_mode: 'blocking',
          user: 'kkoribyeol-web',
          ...(conversationId ? { conversation_id: conversationId } : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      this.log.error(`Dify 연결 실패: ${(e as Error).message}`);
      throw new ServiceUnavailableException({ message: '규정 챗봇에 연결할 수 없어요. 잠시 뒤에 다시 물어봐 주세요.' });
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      this.log.error(`Dify 오류 ${res.status}: ${JSON.stringify(data)?.slice(0, 300)}`);
      throw new ServiceUnavailableException({ message: '규정 챗봇이 답하지 못했어요. 잠시 뒤에 다시 물어봐 주세요.' });
    }

    // 답 아래에 보여 줄 근거: 어느 문서의 어느 조각에서 찾았는지
    const resources: DifyResource[] = data?.metadata?.retriever_resources ?? [];
    return {
      answer: data?.answer ?? '',
      conversationId: data?.conversation_id ?? null,
      sources: resources.map((r) => ({
        document: r.document_name ?? '',
        position: r.segment_position ?? null,
        score: typeof r.score === 'number' ? Math.round(r.score * 100) / 100 : null,
        content: r.content ?? '',
      })),
    };
  }
}
