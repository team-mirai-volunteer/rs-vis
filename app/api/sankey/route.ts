import { NextRequest, NextResponse } from 'next/server';
import { generateSankeyData } from '@/app/lib/sankey-generator';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const limit = parseInt(searchParams.get('limit') || '3', 10);
    const projectLimit = parseInt(searchParams.get('projectLimit') || '3', 10);
    const spendingLimit = parseInt(searchParams.get('spendingLimit') || '3', 10);
    const ministryName = searchParams.get('ministryName') || undefined;
    const projectName = searchParams.get('projectName') || undefined;
    const recipientName = searchParams.get('recipientName') || undefined;

    try {
        const data = await generateSankeyData({
            ministryOffset: offset,
            ministryLimit: limit,
            projectLimit,
            spendingLimit,
            targetMinistryName: ministryName,
            targetProjectName: projectName,
            targetRecipientName: recipientName,
        });
        return NextResponse.json(data);
    } catch (error) {
        console.error('Error generating Sankey data:', error);
        return NextResponse.json({ error: 'Failed to generate data' }, { status: 500 });
    }
}
