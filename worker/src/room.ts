export class MazeRoom {
  private state: DurableObjectState;
  private env: unknown;

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    return new Response("not implemented", { status: 501 });
  }
}
