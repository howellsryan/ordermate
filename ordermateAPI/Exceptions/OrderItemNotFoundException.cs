namespace ordermateAPI.Exceptions;

public class OrderItemNotFoundException : Exception
{
    public OrderItemNotFoundException()
    {
    }

    public OrderItemNotFoundException(string message)
        : base(message)
    {
    }
}