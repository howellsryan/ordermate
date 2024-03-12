namespace ordermateAPI.DAL.Models;

public class OrderItemModel
{
    public int OrderItemId { get; set; }
    public int OrderId { get; set; }
    public int ProductOptionId { get; set; }
    public int Quantity { get; set; }
    public DateTime CreatedDate { get; set; }
    public DateTime LastModifiedDate { get; set; }
}