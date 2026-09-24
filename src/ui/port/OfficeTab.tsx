import { MAX_CONTRACTS, turnInPort } from '../../economy/contracts';
import { FACTION_NAMES } from '../../economy/ports';
import { ContractCard, type TabProps } from './common';

export const OFFICE_NAMES = { imperial: 'Governor', merchant: 'Guildhall', pirate: 'Pirate lord' } as const;

const GREETINGS = {
  imperial: 'The Governor’s secretary looks you over. “His Excellency has work for loyal captains.”',
  merchant: 'Clerks bustle between ledgers. The guild always has cargo that needs moving, and pirates that need sinking.',
  pirate: 'The pirate lord of the island lounges in a stolen chair. “Bring me prizes, and the Brethren will remember.”',
};

/** Legitimate work: freight and bounties from the port's masters, and jobs to hand in. */
export function OfficeTab({ port, economy, sea, act }: TabProps) {
  const offers = economy.offers(port, 'office');
  const mine = sea.captain.contracts.filter((c) => turnInPort(c) === port.id && !(c.kind === 'delivery' && c.black));
  const full = sea.captain.contracts.length >= MAX_CONTRACTS;
  return (
    <section className="tab-office">
      <p className="lede">{GREETINGS[port.faction]}</p>
      {mine.length > 0 && (
        <>
          <h3>To hand in here</h3>
          {mine.map((c) => (
            <ContractCard
              key={c.id}
              contract={c}
              economy={economy}
              sea={sea}
              action={{ label: 'Hand in', disabled: !economy.ready(port, c), onClick: () => act(economy.turnIn(port, c.id)) }}
            />
          ))}
        </>
      )}
      <h3>Work on offer</h3>
      {offers.length === 0 && <p className="hint">Nothing just now. New work is posted every few minutes.</p>}
      {offers.map((c) => (
        <ContractCard
          key={c.id}
          contract={c}
          economy={economy}
          sea={sea}
          action={{ label: 'Accept', disabled: !economy.canAccept(c), onClick: () => act(economy.accept(port, c.id)) }}
        />
      ))}
      <p className="hint">
        {full ? `You have ${MAX_CONTRACTS} jobs on already. ` : ''}Freight needs room in the hold and gold for the bond, which comes back on
        delivery. Jobs done earn standing with {FACTION_NAMES[port.faction]}; jobs failed cost it.
      </p>
    </section>
  );
}
