namespace ordermateAPI.Exceptions;

public class StoreNotFoundException : Exception
{
    public StoreNotFoundException()
    {
    }

    public StoreNotFoundException(string message)
        : base(message)
    {
    }
}