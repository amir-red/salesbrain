import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { PricingInputSchema } from '@/lib/pricing/inputs';
import { calculatePricing, getActiveTool, getToolById } from '@/lib/pricing/engine';

/**
 * POST /api/pricing/calculate
 * Body: { inputs: PricingInputs, tool_id?: string }
 *
 * Evaluates the pricing tool with the given inputs and returns the computed
 * outputs + P&L. If `tool_id` is omitted, uses the currently-active version.
 *
 * Any authenticated user can calculate. Saving is a separate endpoint.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const obj = (body ?? {}) as Record<string, unknown>;
  const inputs = obj.inputs;
  const toolId = typeof obj.tool_id === 'string' ? obj.tool_id : null;

  const parsed = PricingInputSchema.safeParse(inputs);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const tool = toolId ? await getToolById(toolId) : await getActiveTool();
  if (!tool) {
    return NextResponse.json(
      { error: 'No active pricing tool. An admin needs to upload one at /admin/pricing-tool.' },
      { status: 503 }
    );
  }

  try {
    const result = await calculatePricing(tool.storage_path, parsed.data);
    return NextResponse.json({
      tool: { id: tool.id, version: tool.version, filename: tool.filename },
      inputs: parsed.data,
      outputs: result.outputs,
      pnl: result.pnl,
    });
  } catch (err) {
    console.error('[POST /api/pricing/calculate]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Calculation failed' },
      { status: 500 }
    );
  }
}
