export class TimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TimeoutError";
    }
}

export function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    timeoutErrorMsg = 'Operation timed out'
): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
            reject(new TimeoutError(timeoutErrorMsg));
        }, ms);
    });

    return Promise.race([promise, timeoutPromise]);
}