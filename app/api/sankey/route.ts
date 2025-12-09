import { NextRequest, NextResponse } from 'next/server';
import { generateSankeyData } from '@/app/lib/sankey-generator';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const projectOffset = parseInt(searchParams.get('projectOffset') || '0', 10);
    const projectDrilldownLevel = parseInt(searchParams.get('projectDrilldownLevel') || '0', 10);
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const projectLimit = parseInt(searchParams.get('projectLimit') || '15', 10);
    const spendingLimit = parseInt(searchParams.get('spendingLimit') || '10', 10);
    const ministryName = searchParams.get('ministry') || searchParams.get('ministryName') || undefined;
    const projectName = searchParams.get('project') || searchParams.get('projectName') || undefined;
    const recipientName = searchParams.get('recipient') || searchParams.get('recipientName') || undefined;
    const drilldownLevel = parseInt(searchParams.get('drilldownLevel') || '0', 10);

    try {
        const data = await generateSankeyData({
            ministryOffset: 0, // Not used in drilldown mode - drilldownLevel is used instead
            projectOffset, // Deprecated: use projectDrilldownLevel instead
            projectDrilldownLevel,
            ministryLimit: limit,
            projectLimit,
            spendingLimit,
            targetMinistryName: ministryName,
            targetProjectName: projectName,
            targetRecipientName: recipientName,
            drilldownLevel,
        });
        return NextResponse.json(data);
    } catch (error) {
        console.error('Error generating Sankey data:', error);
        return NextResponse.json({ error: 'Failed to generate data' }, { status: 500 });
    }
}
