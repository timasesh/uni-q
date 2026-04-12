import type { Advisor, Ticket } from "../types";

/**
 * Видимость талона для эдвайзера в live-очереди.
 * WAITING: только у выбранного сервером `route_advisor_id` (один владелец при пересечении зон).
 * CALLED / IN_SERVICE: только у эдвайзера, который вызвал.
 */
export function ticketMatchesAdvisor(me: Advisor, ticket: Ticket): boolean {
  if (ticket.status === "CALLED" || ticket.status === "IN_SERVICE") {
    return Number(ticket.advisor_id) === Number(me.id);
  }
  if (ticket.status === "WAITING") {
    if (ticket.route_advisor_id == null) return false;
    return Number(ticket.route_advisor_id) === Number(me.id);
  }
  return false;
}
