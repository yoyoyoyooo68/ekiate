import { INF, type Leg } from '../routing/csa';
import type { Searcher } from '../routing/searcher';
import type { Network } from '../types';
import { START } from '../util/time';

export type Move = {
  station: number;
  time: number; // その駅に着いた時刻
  hint: number | null; // 「次の電車で出たら正解駅に着く時刻」。null = 本日中には着けない。勝った手は time と同じ
  path: Leg[] | null; // 前の駅からの経路（最初の手は null）
};
export type Status = 'playing' | 'won' | 'lost';

export class Game {
  moves: Move[] = [];
  status: Status = 'playing';
  /** いまいる駅から次に出る電車で行ける各駅への到着時刻 */
  reach: Int32Array | null = null;

  /** あきらめて負けになった */
  gaveUp = false;

  constructor(
    readonly net: Network,
    readonly searcher: Searcher,
    readonly answer: number,
  ) {}

  giveUp(): void {
    if (this.status !== 'playing') return;
    this.status = 'lost';
    this.gaveUp = true;
    this.reach = null;
  }

  get current(): number {
    return this.moves.length ? this.moves[this.moves.length - 1].station : -1;
  }
  get time(): number {
    return this.moves.length ? this.moves[this.moves.length - 1].time : START;
  }
  get lastMove(): Move | undefined {
    return this.moves[this.moves.length - 1];
  }

  /** 選べる駅か（最初の手はどの駅でも可。以降は今日中に行ける駅だけ） */
  canGo(station: number): boolean {
    if (this.status !== 'playing') return false;
    if (this.moves.length === 0) return true;
    return station !== this.current && !!this.reach && this.reach[station] < INF;
  }

  /** 到着時刻（最初の手は 5:00、行けないなら null） */
  arrivalAt(station: number): number | null {
    if (this.moves.length === 0) return START;
    if (!this.reach || this.reach[station] >= INF) return null;
    return this.reach[station];
  }

  async step(station: number): Promise<Move> {
    if (this.status !== 'playing') throw new Error('ゲームは終了しています');
    if (!this.canGo(station)) throw new Error('その駅には行けません');
    const first = this.moves.length === 0;
    const time = first ? START : this.reach![station];
    const path = first ? null : await this.searcher.path(this.current, this.time + 1, station);

    if (station === this.answer) {
      const move: Move = { station, time, hint: time, path };
      this.moves.push(move);
      this.status = 'won';
      this.reach = null;
      return move;
    }

    // ヒント: 着いた時刻 +1 分以降に出る電車で正解駅へ（最初の手だけ 5:00 以降）
    const hintReach = await this.searcher.reach(station, first ? START : time + 1);
    const hint = hintReach[this.answer] < INF ? hintReach[this.answer] : null;
    // 次の移動: 着いた時刻 +1 分以降に出る電車
    const nextReach = first ? await this.searcher.reach(station, START + 1) : hintReach;

    const move: Move = { station, time, hint, path };
    this.moves.push(move);
    this.reach = nextReach;
    let any = false;
    for (let i = 0; i < nextReach.length; i++) {
      if (i !== station && nextReach[i] < INF) {
        any = true;
        break;
      }
    }
    if (!any) this.status = 'lost';
    return move;
  }
}
