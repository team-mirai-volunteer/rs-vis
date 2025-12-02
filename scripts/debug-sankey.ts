
import { generateSankeyData } from '../app/lib/sankey-generator';

async function main() {
    try {
        console.log('Generating Sankey Data for Global View...');
        const data = await generateSankeyData({
            ministryOffset: 0,
            projectOffset: 0,
            ministryLimit: 3, // Not used in Global View logic for ministries anymore?
            projectLimit: 3,
            spendingLimit: 5,
        });

        console.log('--- Nodes ---');
        const nodeTypes = new Map<string, number>();
        data.sankey.nodes.forEach(n => {
            const count = nodeTypes.get(n.type) || 0;
            nodeTypes.set(n.type, count + 1);
        });
        console.log('Node Counts by Type:', Object.fromEntries(nodeTypes));

        console.log('\n--- Specific Nodes ---');
        const totalBudget = data.sankey.nodes.find(n => n.id === 'total-budget');
        console.log('Total Budget:', totalBudget ? 'Found' : 'Missing');

        const otherProjectBudget = data.sankey.nodes.find(n => n.id === 'project-budget-other-global');
        console.log('Other Project Budget (Global):', otherProjectBudget ? `Found (Value: ${otherProjectBudget.value})` : 'Missing');

        const otherProjectSpending = data.sankey.nodes.find(n => n.id === 'project-spending-other-global');
        console.log('Other Project Spending (Global):', otherProjectSpending ? `Found (Value: ${otherProjectSpending.value})` : 'Missing');

        const otherRecipient = data.sankey.nodes.find(n => n.id === 'recipient-other-aggregated');
        console.log('Other Recipient (Aggregated):', otherRecipient ? `Found (Value: ${otherRecipient.value})` : 'Missing');

        console.log('\n--- Links ---');
        console.log('Total Links:', data.sankey.links.length);

        // Check links from Ministries to Other Projects
        const ministryToOtherLinks = data.sankey.links.filter(l => l.target === 'project-budget-other-global');
        console.log(`Links to Other Projects: ${ministryToOtherLinks.length}`);

        // Check link from Other Project Budget to Other Project Spending
        const otherBudgetToSpending = data.sankey.links.find(l => l.source === 'project-budget-other-global' && l.target === 'project-spending-other-global');
        console.log('Link Other Budget -> Other Spending:', otherBudgetToSpending ? `Found (Value: ${otherBudgetToSpending.value})` : 'Missing');

        // Check link from Other Project Spending to Other Recipient
        const otherSpendingToRecipient = data.sankey.links.find(l => l.source === 'project-spending-other-global' && l.target === 'recipient-other-aggregated');
        console.log('Link Other Spending -> Other Recipient:', otherSpendingToRecipient ? `Found (Value: ${otherSpendingToRecipient.value})` : 'Missing');

    } catch (error) {
        console.error('Error:', error);
    }
}

main();
