namespace ordermateAPI.Exceptions;

public class ProductOptionNotFoundException : Exception
{
    public ProductOptionNotFoundException()
    {
    }

    public ProductOptionNotFoundException(string message)
        : base(message)
    {
    }
}